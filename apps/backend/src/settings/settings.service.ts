import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { AiProviderResolver } from '../ai-gateway/ai-provider-resolver.service'
import { AiUsageLoggerService, type AiUsageReport, type AiUsageSummary } from '../ai-gateway/ai-usage-logger.service'
import type { LlmProviderName } from '../ai-gateway/providers/llm-provider.interface'
import type { ReportRange } from '../reporting/report-range'

export type { AiUsageSummary } from '../ai-gateway/ai-usage-logger.service'

export interface AiSettings {
  aiProvider: LlmProviderName | null
  effectiveProvider: LlmProviderName
  systemDefault: LlmProviderName
  models: { fast: string; high: string }
  availableProviders: LlmProviderName[]
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly resolver: AiProviderResolver,
    private readonly usage: AiUsageLoggerService,
  ) {}

  async getAiSettings(userId: string): Promise<AiSettings> {
    const aiProvider = await this.resolver.getUserPreference(userId)
    const systemDefault = this.resolver.systemDefault()
    const effectiveProvider = aiProvider ?? systemDefault
    const availableProviders = this.ai.availableProviders()

    return {
      aiProvider,
      effectiveProvider,
      systemDefault,
      // Empty strings if the effective provider has no key configured.
      models: this.ai.modelsFor(effectiveProvider),
      availableProviders,
    }
  }

  async updateAiSettings(userId: string, aiProvider: LlmProviderName | null): Promise<AiSettings> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { aiProvider },
    })
    this.resolver.invalidate(userId)
    this.logger.log(`user=${userId} set aiProvider=${aiProvider ?? 'default'}`)
    return this.getAiSettings(userId)
  }

  async getAiUsage(userId: string): Promise<AiUsageSummary> {
    return this.usage.getSummary(userId)
  }

  async getAiUsageReport(userId: string, range: ReportRange): Promise<AiUsageReport> {
    return this.usage.getReport(userId, range)
  }
}
