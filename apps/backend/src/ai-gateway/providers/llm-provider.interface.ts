/**
 * Provider-agnostic contract for the LLM backends behind AiGatewayService.
 *
 * Adding a provider means adding one file next to this one – call sites never
 * see a provider type (see ADR-001, ADR-003).
 */

export type LlmProviderName = 'OPENAI' | 'ANTHROPIC'

/**
 * Which model tier to use.
 *
 * 'fast' – the default for everything. Anthropic: Haiku, OpenAI: gpt-4o-mini.
 * 'high' – reserved for the few call sites where synthesis quality justifies
 *          the cost. Anthropic: Sonnet. Use sparingly.
 */
export type LlmQuality = 'fast' | 'high'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Options as passed by call sites – everything optional. */
export interface ChatOptions {
  /** Explicit model id. Overrides `quality`. Rarely needed. */
  model?: string
  /** Model tier. Defaults to 'fast'. */
  quality?: LlmQuality
  temperature?: number
  /** When true the response must be valid JSON. */
  jsonMode?: boolean
  /** Max completion tokens. */
  maxTokens?: number
  /**
   * Resolves the provider from the user's saved preference.
   * Every LLM call site has a userId in scope – pass it.
   */
  userId?: string
  /** Explicit provider override. Wins over the user's preference. */
  provider?: LlmProviderName
}

/** Options after AiGatewayService has applied its defaults. */
export interface ResolvedChatOptions {
  model?: string
  quality: LlmQuality
  temperature: number
  jsonMode: boolean
  maxTokens?: number
}

export interface ChatResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface LlmProvider {
  readonly name: LlmProviderName
  /** Returns the assistant's reply plus token counts, for usage tracking. Throws on API errors. */
  chat(messages: ChatMessage[], options: ResolvedChatOptions): Promise<ChatResult>
  /** Model id this provider would use for the given tier – for the settings UI. */
  modelFor(quality: LlmQuality): string
}
