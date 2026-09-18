# ADR-003: Add Anthropic API as a second, user-selectable LLM provider

- **Date:** 2026-08-31
- **Status:** Accepted
- **Deciders:** Houston team
- **Supersedes:** nothing. Extends [ADR-001](./ADR-001-openai-api.md).

## Context

ADR-001 put every LLM call behind `AiGatewayService` and anticipated a provider swap – it assumed
that swap would be to Azure OpenAI. Azure OpenAI is still not provisioned, and in the meantime we
want Houston to run on Claude: better instruction-following on the classification and synthesis
prompts, and a cheaper fast tier than `gpt-4o-mini` for the high-volume scan path.

Two constraints shaped the decision:

- We do not want a hard cutover. Both providers must work side by side so we can compare output
  quality on real scans and roll back instantly if Claude regresses on the Czech prompts.
- The choice must be a **user** setting, not a deploy-time one, so it can be flipped per person
  without a restart.

## Decision

Run **both** providers behind `AiGatewayService`, selected per user.

1. `AiGatewayService` keeps its `chat(messages, options) => Promise<string>` surface. The OpenAI
   client moved into `providers/openai.provider.ts`; `providers/anthropic.provider.ts` joins it
   behind the `LlmProvider` interface. No call site sees a provider type.
2. Provider precedence: `options.provider` → `users.aiProvider` → env `AI_PROVIDER` → `OPENAI`.
   The column is nullable; `null` means "follow the deployment default", so changing `AI_PROVIDER`
   moves everyone who never chose.
3. Providers are constructed **lazily**. A deployment configured with only one API key boots fine;
   the error surfaces only if a user is actually pointed at the unconfigured provider.
4. Two model tiers, `fast` and `high`. Anthropic: `claude-haiku-4-5` / `claude-sonnet-5`.
   **Only `TaskResponseGeneratorService` uses `high`** – it produces the answer the user reads,
   synthesised over the full context block. Scan classification, intent analysis and draft
   regeneration all stay on Haiku.

### Mapping the OpenAI request shape onto Anthropic

| Concern | Handling |
|---|---|
| `system` role | Lifted out of `messages` into the top-level `system` param; multiple system messages concatenate. |
| `max_tokens` | Mandatory on Anthropic, and a hard ceiling – overshooting truncates the JSON mid-document. Defaults to 32000; callers that pass their own keep it. A real scan classification (26 Gmail + 70 Slack + 15 calendar items) spent 11.3K output tokens, and headroom is free (you pay per token generated, not per ceiling). |
| JSON mode | No `response_format` equivalent. A JSON instruction is appended to `system`, and every jsonMode reply goes through `extractJson()`. |
| `temperature` | Accepted by Haiku 4.5, **rejected with a 400 by Sonnet 5** ("deprecated for this model"). Sent only where supported. |
| `thinking` | Explicitly `disabled`. Adaptive thinking spends the same `max_tokens` budget the JSON reply needs – with `maxTokens: 4000` on the task generator it could truncate the JSON. These are extraction/synthesis tasks, not reasoning ones. |

The temperature/effort split above was established by probing the live API, not inferred from model
names. Unknown models (someone overriding `ANTHROPIC_MODEL_*`) start optimistic and self-correct:
a 400 naming `temperature` triggers one retry without it, and the result is remembered.

### `extractJson()` applies to both providers

Three call sites do a bare `JSON.parse()` on the reply. OpenAI's `json_object` mode guarantees bare
JSON; Anthropic has no equivalent, and Haiku wraps its answer in a ```` ```json ```` fence often
enough to break the parse (observed in the probe). The helper is a no-op on already-bare JSON, so
running it on both paths costs nothing and removes a real crash class from the OpenAI path too.

## Consequences

### Positive
- Both providers usable side by side; per-user switch, no restart, instant rollback.
- Cheaper high-volume path (Haiku vs `gpt-4o-mini`) and a stronger model where it matters.
- The provider layer is now genuinely pluggable – Azure OpenAI becomes one more file.
- `JSON.parse` call sites are hardened regardless of provider.

### Negative / Risks
- Two SDKs, two sets of quirks, two paths to regression-test on prompt changes.
- Data leaves the Azure tenancy for Anthropic too – same GDPR note as ADR-001 applies, add
  Anthropic to the privacy register.
- Prompts are tuned for GPT. They transfer, but per-tier quality on the Czech scan prompts should
  be spot-checked rather than assumed.
- `OPENAI_API_KEY` is no longer required at boot. A deployment that sets neither key now fails
  validation with an explicit "at least one of" error instead of a missing-var one.

## Migration Path

Azure OpenAI, when it arrives, is a third `LlmProvider` implementation plus an `AZURE` enum value –
the shape ADR-001 asked for, now with a second implementation proving it works.
