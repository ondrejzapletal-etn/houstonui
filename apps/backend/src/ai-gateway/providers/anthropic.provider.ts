/**
 * Anthropic implementation of LlmProvider (ADR-003).
 *
 * Five things differ from the OpenAI shape and are handled here so call sites
 * stay provider-agnostic:
 *   1. `system` is a top-level parameter, not a message role.
 *   2. `max_tokens` is mandatory.
 *   3. There is no `response_format` – JSON mode is a system-prompt instruction,
 *      and the reply goes through extractJson() in AiGatewayService.
 *   4. `temperature` is rejected by the 4.6+/5 generation; `output_config.effort`
 *      is rejected by the 4.5 generation. See MODEL_QUIRKS.
 *   5. The SDK refuses a non-streaming request outright once max_tokens implies
 *      more than 10 minutes of generation at its assumed throughput – a client-side
 *      guard, independent of model or actual latency (formula: max_tokens/128000
 *      hours; threshold ≈21,333 tokens). DEFAULT_MAX_TOKENS sits above that, so
 *      every request streams and collects the final message – see chat() below.
 */

import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import Anthropic from '@anthropic-ai/sdk'
import type {
  ChatMessage,
  ChatResult,
  LlmProvider,
  LlmQuality,
  ResolvedChatOptions,
} from './llm-provider.interface'

const DEFAULT_MODEL_FAST = 'claude-haiku-4-5'
const DEFAULT_MODEL_HIGH = 'claude-sonnet-5'

/**
 * Anthropic requires max_tokens, and it is a hard ceiling: overshooting it
 * truncates the JSON mid-document and breaks the caller's JSON.parse.
 *
 * A real scan classification (26 Gmail + 70 Slack + 15 calendar items) spent
 * 11.3K output tokens, so the ceiling has to sit well above that. You are billed
 * for tokens generated, not for the ceiling, so headroom is free – 32K leaves
 * ~3x the observed load and is still half of Haiku 4.5's 64K output cap.
 * Call sites that pass maxTokens keep their own value.
 */
const DEFAULT_MAX_TOKENS = 32000

const JSON_INSTRUCTION =
  'Return a single valid JSON document. Output raw JSON only – no markdown code fences, no prose before or after.'

interface ModelQuirks {
  /** Removed on the 4.6+/5 generation: "`temperature` is deprecated for this model" (400). */
  supportsTemperature: boolean
}

/**
 * Seeded from a live probe of the two default models, so the common path never
 * pays for discovery. Unknown models start optimistic and self-correct in
 * chat() on the first 400 – no model-name regex to rot when a new model ships.
 */
const MODEL_QUIRKS = new Map<string, ModelQuirks>([
  ['claude-haiku-4-5', { supportsTemperature: true }],
  ['claude-sonnet-5', { supportsTemperature: false }],
])

export class AnthropicProvider implements LlmProvider {
  readonly name = 'ANTHROPIC' as const
  private readonly logger = new Logger(AnthropicProvider.name)
  private readonly client: Anthropic
  private readonly modelFast: string
  private readonly modelHigh: string

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY')
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set – cannot use the Anthropic provider. ' +
          'Set the key or switch the AI provider to OpenAI in Settings.',
      )
    }
    this.client = new Anthropic({ apiKey })
    this.modelFast = config.get<string>('ANTHROPIC_MODEL_FAST') ?? DEFAULT_MODEL_FAST
    this.modelHigh = config.get<string>('ANTHROPIC_MODEL_HIGH') ?? DEFAULT_MODEL_HIGH
  }

  modelFor(quality: LlmQuality): string {
    return quality === 'high' ? this.modelHigh : this.modelFast
  }

  async chat(messages: ChatMessage[], options: ResolvedChatOptions): Promise<ChatResult> {
    const model = options.model ?? this.modelFor(options.quality)

    // system is a top-level param; multiple system messages concatenate.
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
    if (options.jsonMode) systemParts.push(JSON_INSTRUCTION)
    const system = systemParts.join('\n\n')

    const turns = messages
      .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: turns,
      ...(system ? { system } : {}),
      // Adaptive thinking would spend the same max_tokens budget the JSON reply
      // needs (and these are extraction/synthesis tasks, not reasoning ones).
      thinking: { type: 'disabled' },
    }

    const quirks = MODEL_QUIRKS.get(model)
    // Optimistic for unknown models – the catch below records the real answer.
    if (quirks?.supportsTemperature !== false) request.temperature = options.temperature

    let response: Anthropic.Message
    try {
      response = await this.createMessage(request)
    } catch (err) {
      if (this.isDeprecatedTemperatureError(err) && request.temperature !== undefined) {
        this.logger.warn(`anthropic: model=${model} rejects temperature – retrying without it`)
        MODEL_QUIRKS.set(model, { supportsTemperature: false })
        const { temperature: _dropped, ...retry } = request
        response = await this.createMessage(retry)
      } else {
        throw err
      }
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')

    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens

    this.logger.debug(
      `anthropic: model=${model} out_chars=${text.length} ` +
        `in_tokens=${inputTokens} out_tokens=${outputTokens} stop=${response.stop_reason}`,
    )

    if (response.stop_reason === 'max_tokens') {
      this.logger.warn(
        `anthropic: model=${model} hit max_tokens=${request.max_tokens} – reply is truncated`,
      )
    }

    return { text, inputTokens, outputTokens }
  }

  /**
   * Always goes through the streaming endpoint and collects the final message.
   * Non-streaming `messages.create()` throws client-side ("Streaming is required
   * for operations that may take longer than 10 minutes") once max_tokens implies
   * more than 10 minutes of generation – true for DEFAULT_MAX_TOKENS regardless
   * of how long the call actually takes. `.stream().finalMessage()` sidesteps that
   * check entirely and returns the same Message shape `.create()` would.
   */
  private async createMessage(
    request: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    return this.client.messages.stream(request).finalMessage()
  }

  /** A 400 that names `temperature` – the only error we self-correct from. */
  private isDeprecatedTemperatureError(err: unknown): boolean {
    return (
      err instanceof Anthropic.BadRequestError && /\btemperature\b/i.test(String(err.message))
    )
  }
}
