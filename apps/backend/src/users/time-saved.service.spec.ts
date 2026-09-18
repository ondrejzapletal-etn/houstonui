import { Test } from '@nestjs/testing'
import { TimeSavedService } from './time-saved.service'
import { PrismaService } from '../prisma/prisma.service'

describe('TimeSavedService', () => {
  const build = async (findMany: jest.Mock = jest.fn().mockResolvedValue([]), create = jest.fn()) => {
    const module = await Test.createTestingModule({
      providers: [
        TimeSavedService,
        { provide: PrismaService, useValue: { timeSavedEvent: { create, findMany } } },
      ],
    }).compile()

    return { service: module.get(TimeSavedService), create, findMany }
  }

  describe('record', () => {
    it('persists the kind with a default count of 1', async () => {
      const create = jest.fn().mockResolvedValue({})
      const { service } = await build(undefined, create)

      await service.record('u1', 'scan')

      expect(create).toHaveBeenCalledWith({
        data: { userId: 'u1', kind: 'scan', count: 1 },
      })
    })

    it('persists an explicit count for batch actions', async () => {
      const create = jest.fn().mockResolvedValue({})
      const { service } = await build(undefined, create)

      await service.record('u1', 'auto_read', 7)

      expect(create).toHaveBeenCalledWith({
        data: { userId: 'u1', kind: 'auto_read', count: 7 },
      })
    })

    it('skips a zero or negative count without touching the DB', async () => {
      const create = jest.fn().mockResolvedValue({})
      const { service } = await build(undefined, create)

      await service.record('u1', 'auto_read', 0)
      await service.record('u1', 'auto_read', -3)

      expect(create).not.toHaveBeenCalled()
    })

    // Recording must never fail the action it's attached to.
    it('swallows a DB failure instead of throwing', async () => {
      const create = jest.fn().mockRejectedValue(new Error('connection refused'))
      const { service } = await build(undefined, create)

      await expect(service.record('u1', 'worklog')).resolves.toBeUndefined()
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

    const event = (iso: string, kind: string, count: number) => ({
      createdAt: new Date(iso),
      kind,
      count,
    })

    it('queries from the start of the month 2 months back', async () => {
      const { service, findMany } = await build()

      await service.getSummary('u1')

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', createdAt: { gte: new Date('2026-06-01T00:00:00.000Z') } },
        select: { createdAt: true, kind: true, count: true },
      })
    })

    it('produces 7 zero-filled daily buckets and 3 zero-filled monthly buckets when there are no events', async () => {
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
      const allZero = (counts: Record<string, number>) =>
        Object.values(counts).every((v) => v === 0)
      expect(summary.daily.every((b) => allZero(b.counts))).toBe(true)
      expect(summary.monthly.every((b) => allZero(b.counts))).toBe(true)
      // Every known kind is present even with no data.
      expect(Object.keys(summary.daily[0].counts).sort()).toEqual([
        'auto_read',
        'mark_read',
        'processed_message',
        'scan',
        'worklog',
      ])
    })

    it('buckets events into the correct day and month, summing counts per kind', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          event('2026-08-31T09:00:00Z', 'scan', 1),
          event('2026-08-31T15:00:00Z', 'scan', 1), // same day, different hour
          event('2026-08-31T16:00:00Z', 'auto_read', 5),
          event('2026-08-20T00:00:00Z', 'mark_read', 1), // outside daily window, inside August
          event('2026-07-15T00:00:00Z', 'worklog', 1),
          event('2026-06-01T00:00:00Z', 'processed_message', 1), // earliest bucket edge
        ])
      const { service } = await build(findMany)

      const summary = await service.getSummary('u1')

      const aug31 = summary.daily.find((b) => b.period === '2026-08-31')!
      expect(aug31.counts.scan).toBe(2)
      expect(aug31.counts.auto_read).toBe(5)
      expect(aug31.counts.mark_read).toBe(0)

      // 2026-08-20 has no daily bucket (only the last 7 days are kept).
      expect(summary.daily.find((b) => b.period === '2026-08-20')).toBeUndefined()

      const august = summary.monthly.find((b) => b.period === '2026-08')!
      expect(august.counts.scan).toBe(2)
      expect(august.counts.auto_read).toBe(5)
      expect(august.counts.mark_read).toBe(1)

      const july = summary.monthly.find((b) => b.period === '2026-07')!
      expect(july.counts.worklog).toBe(1)

      const june = summary.monthly.find((b) => b.period === '2026-06')!
      expect(june.counts.processed_message).toBe(1)
    })

    it('ignores an unknown kind written by a future version of the app', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          event('2026-08-31T09:00:00Z', 'scan', 1),
          event('2026-08-31T10:00:00Z', 'teleport', 99),
        ])
      const { service } = await build(findMany)

      const summary = await service.getSummary('u1')
      const aug31 = summary.daily.find((b) => b.period === '2026-08-31')!

      expect(aug31.counts.scan).toBe(1)
      expect(Object.values(aug31.counts).reduce((a, b) => a + b, 0)).toBe(1)
    })
  })
})
