import { Test } from '@nestjs/testing'
import { SettingsService } from './settings.service'
import { PrismaService } from '../prisma/prisma.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { AiProviderResolver } from '../ai-gateway/ai-provider-resolver.service'
import { AiUsageLoggerService } from '../ai-gateway/ai-usage-logger.service'
import type { AiUsageSummary } from '../ai-gateway/ai-usage-logger.service'

describe('SettingsService', () => {
  const build = async (getSummary: jest.Mock) => {
    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: { user: { update: jest.fn() } } },
        { provide: AiGatewayService, useValue: { availableProviders: jest.fn(), modelsFor: jest.fn() } },
        {
          provide: AiProviderResolver,
          useValue: { getUserPreference: jest.fn(), systemDefault: jest.fn(), invalidate: jest.fn() },
        },
        { provide: AiUsageLoggerService, useValue: { getSummary } },
      ],
    }).compile()

    return module.get(SettingsService)
  }

  it('delegates getAiUsage to AiUsageLoggerService.getSummary for the given user', async () => {
    const summary: AiUsageSummary = { daily: [], monthly: [] }
    const getSummary = jest.fn().mockResolvedValue(summary)
    const service = await build(getSummary)

    const result = await service.getAiUsage('u1')

    expect(getSummary).toHaveBeenCalledWith('u1')
    expect(result).toBe(summary)
  })
})
