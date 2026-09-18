# ADR-001: Use OpenAI API for AI Gateway (v1)

- **Date:** 2026-05-12
- **Status:** Accepted
- **Deciders:** Houston team

## Context

Houston NextGen requires a backend-mediated LLM for the Scan agent (classification, tiering, draft
generation). The target architecture (`docs/05-azure.md`) specifies Azure OpenAI as the long-term
cloud service. However, in v1 we need to iterate quickly on the scan logic and the Azure OpenAI
deployment is not yet provisioned.

## Decision

Use the **standard OpenAI API** (`api.openai.com`) in v1 behind an internal `AiGatewayModule`.
The API key is held exclusively in the backend (env var `OPENAI_API_KEY`); the desktop client
never receives or transmits this key.

The `AiGatewayService` interface is designed to be provider-agnostic so the underlying provider
can be swapped to Azure OpenAI in a future ADR without changing call sites.

## Consequences

### Positive
- Fast iteration – no Azure provisioning required.
- Clean abstraction (`AiGatewayService.chat()`) isolates provider details.
- No secrets in desktop (architecture rule enforced).

### Negative / Risks
- Data leaves the Azure tenancy (GDPR consideration: OpenAI has a zero-data-retention policy
  for API calls when using a paid tier; document this in the privacy register).
- In production, must be migrated to Azure OpenAI before GA.

## Migration Path

When Azure OpenAI is available:
1. Create `ADR-002-azure-openai.md`.
2. Add `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_KEY` to env validation.
3. Swap the implementation inside `AiGatewayService` – no other files change.
4. Remove `OPENAI_API_KEY` from env.
