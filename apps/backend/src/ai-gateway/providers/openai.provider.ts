/**
 * OpenAI implementation of LlmProvider.
 *
 * Behaviour is unchanged from the pre-multi-provider AiGatewayService (ADR-001):
 * chat completions, JSON mode via response_format, optional max_tokens.
 */

import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import type {
  ChatMessage,
  ChatResult,
  LlmProvider,
  LlmQuality,
  ResolvedChatOptions,
} from './llm-provider.interface'

const DEFAULT_MODEL_FAST = 'gpt-4o-mini'
const DEFAULT_MODEL_HIGH = 'gpt-4o'

export class OpenAiProvider implements LlmProvider {
  readonly name = 'OPENAI' as const
  private readonly logger = new Logger(OpenAiProvider.name)
  private readonly client: OpenAI
  private readonly modelFast: string
  private readonly modelHigh: string

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set – cannot use the OpenAI provider. ' +
          'Set the key or switch the AI provider to Anthropic in Settings.',
      )
    }
    this.client = new OpenAI({ apiKey })
    this.modelFast = config.get<string>('OPENAI_MODEL') ?? DEFAULT_MODEL_FAST
    this.modelHigh = config.get<string>('OPENAI_MODEL_HIGH') ?? DEFAULT_MODEL_HIGH
  }

  modelFor(quality: LlmQuality): string {
    return quality === 'high' ? this.modelHigh : this.modelFast
  }

  async chat(messages: ChatMessage[], options: ResolvedChatOptions): Promise<ChatResult> {
    const model = options.model ?? this.modelFor(options.quality)

    const completion = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    })

    const text = completion.choices[0]?.message?.content ?? ''
    const inputTokens = completion.usage?.prompt_tokens ?? 0
    const outputTokens = completion.usage?.completion_tokens ?? 0
    this.logger.debug(
      `openai: model=${model} out_chars=${text.length} in_tokens=${inputTokens} out_tokens=${outputTokens}`,
    )
    return { text, inputTokens, outputTokens }
  }
}
