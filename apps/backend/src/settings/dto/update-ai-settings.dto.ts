import { IsIn, ValidateIf } from 'class-validator'
import type { LlmProviderName } from '../../ai-gateway/providers/llm-provider.interface'

export class UpdateAiSettingsDto {
  /**
   * null clears the choice and falls back to the deployment default (AI_PROVIDER).
   * ValidateIf lets null through @IsIn, which would otherwise reject it.
   */
  @ValidateIf((_, value) => value !== null)
  @IsIn(['OPENAI', 'ANTHROPIC'], { message: 'aiProvider must be OPENAI, ANTHROPIC or null' })
  aiProvider!: LlmProviderName | null
}
