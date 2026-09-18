import { Test } from '@nestjs/testing'
import { AiUsageLoggerService } from './ai-usage-logger.service'
import { PrismaService } from '../prisma/prisma.service'

describe('AiUsageLoggerService', () => {
  const build = async (findMany: jest.Mock = jest.fn().mockResolvedValue([]), create = jest.fn()) => {
    const module = await Test.createTestingModule({
      providers: [
        AiUsageLoggerService,
        { provide: PrismaService, useValue: { aiUsageLog: { create, findMany } } },
      ],
    }).compile()

    return { service: module.get(AiUsageLoggerService), create, findMany }
  }

  describe('record', () => {
    it('persists tokens and the computed cost', async () => {
      const create = jest.fn().mockResolvedValue({})
      const { service } = await build(undefined, create)

      await service.record({
        userId: 'u1',
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        quality: 'fast',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })

      expect(create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          provider: 'ANTHROPIC',
          model: 'claude-haiku-4-5',
          quality: 'fast',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          costUsd: 6,
        },
      })
    })

    it('stores a null cost for a model with no pricing entry', async () => {
      const create = jest.fn().mockResolvedValue({})
      const { service } = await build(undefined, create)

      await service.record({
        userId: 'u1',
        provider: 'ANTHROPIC',
        model: 'some-future-model',
        quality: 'fast',
        inputTokens: 100,
        outputTokens: 100,
      })

      expect(create.mock.calls[0][0].data.costUsd).toBeNull()
    })

    // Recording usage must never fail the LLM call it's attached to.
    it('swallows a DB failure instead of throwing', async () => {
      const create = jest.fn().mockRejectedValue(new Error('connection refused'))
      const { service } = await build(undefined, create)

      await expect(
        service.record({
          userId: 'u1',
          provider: 'OPENAI',
          model: 'gpt-4o-mini',
          quality: 'fast',
          inputTokens: 10,
          outputTokens: 10,
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('getSummary', () => {
    const NOW = new Date('2026-08-31T12:00:00.000Z')

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW)
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    const log = (iso: string, inputTokens: number, outputTokens: number, costUsd: number | null) => ({
      createdAt: new Date(iso),
      inputTokens,
      outputTokens,
      costUsd,
    })

    it('queries from the start of the month 2 months back', async () => {
      const { service, findMany } = await build()

      await service.getSummary('u1')

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', createdAt: { gte: new Date('2026-06-01T00:00:00.000Z') } },
        select: { createdAt: true, inputTokens: true, outputTokens: true, costUsd: true },
      })
    })

    it('produces 7 zero-filled daily buckets and 3 zero-filled monthly buckets when there is no usage', async () => {
      const { service } = await build()

      const summary = await service.getSummary('u1')

      expect(summary.daily.map((b) => b.period)).toEqual([
        '2026-08-25',
        '2026-08-26',
        '2026-08-27',
        '2026-08-28',
        '2026-08-29',
        '2026-08-30',
        '2026-08-31',
      ])
      expect(summary.monthly.map((b) => b.period)).toEqual(['2026-06', '2026-07', '2026-08'])
      expect(summary.daily.every((b) => b.totalTokens === 0 && b.costUsd === 0)).toBe(true)
      expect(summary.monthly.every((b) => b.totalTokens === 0 && b.costUsd === 0)).toBe(true)
    })

    it('buckets logs into the correct day and month, summing multiple calls', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          log('2026-08-31T09:00:00Z', 100, 50, 0.001),
          log('2026-08-31T15:00:00Z', 200, 100, 0.002), // same day, different hour
          log('2026-08-20T00:00:00Z', 10, 10, 0.0001), // outside daily window, inside August
          log('2026-07-15T00:00:00Z', 5, 5, 0.00005),
          log('2026-06-01T00:00:00Z', 1, 1, 0.00001), // earliest bucket edge
        ])
      const { service } = await build(findMany)

      const summary = await service.getSummary('u1')

      const aug31 = summary.daily.find((b) => b.period === '2026-08-31')!
      expect(aug31.inputTokens).toBe(300)
      expect(aug31.outputTokens).toBe(150)
      expect(aug31.totalTokens).toBe(450)
      expect(aug31.costUsd).toBeCloseTo(0.003, 6)

      // 2026-08-20 has no daily bucket (only the last 7 days are kept).
      expect(summary.daily.find((b) => b.period === '2026-08-20')).toBeUndefined()

      const august = summary.monthly.find((b) => b.period === '2026-08')!
      expect(august.totalTokens).toBe(300 + 150 + 10 + 10) // Aug 31 x2 + Aug 20
      expect(august.costUsd).toBeCloseTo(0.0031, 6)

      const july = summary.monthly.find((b) => b.period === '2026-07')!
      expect(july.totalTokens).toBe(10)

      const june = summary.monthly.find((b) => b.period === '2026-06')!
      expect(june.totalTokens).toBe(2)
    })

    it('flags a bucket with unknown pricing and excludes it from the cost sum', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          log('2026-08-31T09:00:00Z', 100, 100, 0.5),
          log('2026-08-31T10:00:00Z', 100, 100, null), // model with no pricing entry
        ])
      const { service } = await build(findMany)

      const summary = await service.getSummary('u1')
      const aug31 = summary.daily.find((b) => b.period === '2026-08-31')!

      expect(aug31.totalTokens).toBe(400)
      expect(aug31.costUsd).toBeCloseTo(0.5, 6) // the null-cost call contributes 0, not NaN
      expect(aug31.hasUnknownPricing).toBe(true)
    })
  })
})
