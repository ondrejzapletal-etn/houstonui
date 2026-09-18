/**
 * USD pricing per model, for the usage/cost summary in Settings → AI model.
 *
 * Anthropic figures are the published per-token rates for the models this
 * deployment defaults to. OpenAI figures are the long-stable public rates for
 * gpt-4o-mini/gpt-4o; verify against platform.openai.com/pricing if raised.
 *
 * A model not listed here (e.g. someone overriding ANTHROPIC_MODEL_FAST to a
 * model that didn't exist when this table was written) returns null rather
 * than a guessed price – token counts are still recorded, just the cost isn't.
 */

interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  // OpenAI
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
}

/** Cost in USD for one call, or null if the model has no pricing entry. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING[model]
  if (!pricing) return null
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  )
}
