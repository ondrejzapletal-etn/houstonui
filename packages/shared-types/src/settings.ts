/**
 * User settings that live in Postgres (as opposed to the client-side settings
 * in localStorage). Currently just the LLM provider choice.
 */

/** LLM provider behind AiGatewayService (ADR-001 OpenAI, ADR-003 Anthropic). */
export type AiProviderName = 'OPENAI' | 'ANTHROPIC'

export interface AiSettings {
  /** The user's explicit choice. null = follow the deployment default. */
  aiProvider: AiProviderName | null
  /** The provider this user's calls actually go to (choice, or the default). */
  effectiveProvider: AiProviderName
  /** The deployment default (env AI_PROVIDER) – what `aiProvider: null` means. */
  systemDefault: AiProviderName
  /** Model ids the effective provider uses per tier. */
  models: { fast: string; high: string }
  /** Providers with an API key configured on the server. Others are unselectable. */
  availableProviders: AiProviderName[]
}

export interface UpdateAiSettingsRequest {
  aiProvider: AiProviderName | null
}

export interface AiUsageBucket {
  /** 'YYYY-MM-DD' for a daily bucket, 'YYYY-MM' for a monthly one. */
  period: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Sum of the calls with known pricing. Undercounts if hasUnknownPricing is true. */
  costUsd: number
  /** True if a call in this bucket used a model with no known price (cost is a lower bound). */
  hasUnknownPricing: boolean
}

export interface AiUsageSummary {
  /** Last 7 days, oldest first, zero-filled for days with no usage. */
  daily: AiUsageBucket[]
  /** Last 3 months, oldest first, zero-filled for months with no usage. */
  monthly: AiUsageBucket[]
}
