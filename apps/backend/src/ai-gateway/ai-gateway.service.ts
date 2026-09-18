/**
 * AiGatewayService
 *
 * Backend-mediated access to the LLM. API keys live exclusively in env vars –
 * never exposed to clients.
 *
 * Two providers are supported side by side (ADR-001 OpenAI, ADR-003 Anthropic);
 * which one runs is a per-user setting resolved from `options.userId`. Call sites
 * see only `chat(messages, options) => string` and never a provider type.
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiProviderResolver } from './ai-provider-resolver.service'
import { AiUsageLoggerService } from './ai-usage-logger.service'
import { extractJson } from './extract-json'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenAiProvider } from './providers/openai.provider'
import type {
  ChatMessage,
  ChatOptions,
  LlmProvider,
  LlmProviderName,
  LlmQuality,
} from './providers/llm-provider.interface'

export type {
  ChatMessage,
  ChatOptions,
  LlmProviderName,
  LlmQuality,
} from './providers/llm-provider.interface'

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name)
  /**
   * Providers are built on first use, not in the constructor: a deployment that
   * configures only one API key must still boot.
   */
  private readonly providers = new Map<LlmProviderName, LlmProvider>()

  constructor(
    private readonly config: ConfigService,
    private readonly resolver: AiProviderResolver,
    private readonly usageLogger: AiUsageLoggerService,
  ) {}

  /**
   * Send a chat completion request.
   * Returns the assistant's reply as a plain string.
   * Throws on API errors.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const { temperature = 0.2, jsonMode = false, maxTokens, quality = 'fast' } = options

    const providerName = options.provider ?? (await this.resolver.resolve(options.userId))
    const provider = this.getProvider(providerName)
    const model = options.model ?? provider.modelFor(quality)

    // basic instrumentation: count messages, chars and estimate tokens (chars/4 heuristic)
    const messagesCount = messages.length
    const inputChars = messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0)
    const estimatedTokens = Math.max(1, Math.ceil(inputChars / 4))

    this.logger.debug(
      `chat: provider=${providerName} quality=${quality} model=${model} ` +
        `messages=${messagesCount} json=${jsonMode} input_chars=${inputChars} est_tokens=${estimatedTokens}`,
    )

    const result = await provider.chat(messages, {
      model: options.model,
      quality,
      temperature,
      jsonMode,
      maxTokens,
    })

    // A userId is required to attribute cost to someone; the few internal
    // calls that omit it (or pass an explicit provider without one) aren't logged.
    if (options.userId) {
      await this.usageLogger.record({
        userId: options.userId,
        provider: providerName,
        model,
        quality,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
    }

    // Both providers go through extractJson: OpenAI's json_object mode already
    // returns bare JSON, but the helper is a no-op there and guards the three
    // unguarded JSON.parse call sites against either provider drifting.
    return jsonMode ? extractJson(result.text) : result.text
  }

  /** Which providers have an API key configured – for the settings UI. */
  availableProviders(): LlmProviderName[] {
    const available: LlmProviderName[] = []
    if (this.config.get<string>('OPENAI_API_KEY')) available.push('OPENAI')
    if (this.config.get<string>('ANTHROPIC_API_KEY')) available.push('ANTHROPIC')
    return available
  }

  /**
   * Model ids a provider would use, per tier – for the settings UI.
   * Returns empty strings for a provider with no API key rather than throwing:
   * this is an informational read, not a request to use the provider.
   */
  modelsFor(providerName: LlmProviderName): { fast: string; high: string } {
    try {
      const provider = this.getProvider(providerName)
      return { fast: provider.modelFor('fast'), high: provider.modelFor('high') }
    } catch {
      return { fast: '', high: '' }
    }
  }

  private getProvider(name: LlmProviderName): LlmProvider {
    const existing = this.providers.get(name)
    if (existing) return existing

    const provider: LlmProvider =
      name === 'ANTHROPIC' ? new AnthropicProvider(this.config) : new OpenAiProvider(this.config)
    this.providers.set(name, provider)
    return provider
  }
}
