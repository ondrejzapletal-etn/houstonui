/**
 * Persists one row per time-saving action and serves the daily/monthly count
 * summary shown in Settings → Úspora času. Only counts are stored – the client
 * multiplies them by its configurable seconds-per-action coefficients, so a
 * coefficient change retroactively recomputes all history.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { createReportRangeWindow, type ReportRange } from '../reporting/report-range'

export const TIME_SAVED_KINDS = [
  'scan',
  'processed_message',
  'auto_read',
  'mark_read',
  'worklog',
] as const

export type TimeSavedKind = (typeof TIME_SAVED_KINDS)[number]

export interface TimeSavedBucket {
  /** 'YYYY-MM-DD' for a daily bucket, 'YYYY-MM' for a monthly one. */
  period: string
  /** Action counts per kind, zero-filled for every known kind. */
  counts: Record<TimeSavedKind, number>
}

export interface TimeSavedSummary {
  /** Last 7 days, oldest first, zero-filled for days with no actions. */
  daily: TimeSavedBucket[]
  /** Last 3 months, oldest first, zero-filled for months with no actions. */
  monthly: TimeSavedBucket[]
}

export interface TimeSavedReport extends ReportRange {
  buckets: TimeSavedBucket[]
}

const DAILY_DAYS = 7
const MONTHLY_MONTHS = 3

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function utcMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

function emptyBucket(period: string): TimeSavedBucket {
  const counts = Object.fromEntries(TIME_SAVED_KINDS.map((k) => [k, 0])) as Record<
    TimeSavedKind,
    number
  >
  return { period, counts }
}

@Injectable()
export class TimeSavedService {
  private readonly logger = new Logger(TimeSavedService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget from the caller's perspective: a logging failure must never
   * fail the action it's recording, so this method catches and warns instead
   * of throwing.
   */
  async record(userId: string, kind: TimeSavedKind, count = 1): Promise<void> {
    if (count <= 0) return
    try {
      await this.prisma.timeSavedEvent.create({
        data: { userId, kind, count },
      })
    } catch (err) {
      this.logger.warn(
        `Failed to record time-saved event for user=${userId} kind=${kind}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async getSummary(userId: string): Promise<TimeSavedSummary> {
    const now = new Date()

    // One query window covers both breakdowns: 3 months back always contains
    // the last 7 days too.
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHLY_MONTHS - 1), 1),
    )

    const events = await this.prisma.timeSavedEvent.findMany({
      where: { userId, createdAt: { gte: rangeStart } },
      select: { createdAt: true, kind: true, count: true },
    })

    const dailyKeys: string[] = []
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() - i)
      dailyKeys.push(utcDayKey(d))
    }

    const monthlyKeys: string[] = []
    for (let i = MONTHLY_MONTHS - 1; i >= 0; i--) {
      monthlyKeys.push(utcMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))))
    }

    const dailyBuckets = new Map(dailyKeys.map((k) => [k, emptyBucket(k)]))
    const monthlyBuckets = new Map(monthlyKeys.map((k) => [k, emptyBucket(k)]))

    for (const event of events) {
      this.accumulate(dailyBuckets, utcDayKey(event.createdAt), event)
      this.accumulate(monthlyBuckets, utcMonthKey(event.createdAt), event)
    }

    return {
      daily: dailyKeys.map((k) => dailyBuckets.get(k)!),
      monthly: monthlyKeys.map((k) => monthlyBuckets.get(k)!),
    }
  }

  async getReport(userId: string, range: ReportRange): Promise<TimeSavedReport> {
    const window = createReportRangeWindow(range)
    const events = await this.prisma.timeSavedEvent.findMany({
      where: { userId, createdAt: { gte: window.fromDate, lt: window.toDateExclusive } },
      select: { createdAt: true, kind: true, count: true },
    })
    const buckets = new Map(window.periodKeys.map((key) => [key, emptyBucket(key)]))

    for (const event of events) {
      const key = window.granularity === 'daily' ? utcDayKey(event.createdAt) : utcMonthKey(event.createdAt)
      this.accumulate(buckets, key, event)
    }

    return {
      from: range.from,
      to: range.to,
      granularity: range.granularity,
      buckets: window.periodKeys.map((key) => buckets.get(key)!),
    }
  }

  private accumulate(
    buckets: Map<string, TimeSavedBucket>,
    key: string,
    event: { kind: string; count: number },
  ): void {
    // Only present for keys inside the requested window – an event just outside
    // the daily window but inside the monthly one legitimately has no bucket.
    const bucket = buckets.get(key)
    if (!bucket) return

    // A kind written by a future version of the app is skipped rather than crashing.
    if (!(TIME_SAVED_KINDS as readonly string[]).includes(event.kind)) return

    bucket.counts[event.kind as TimeSavedKind] += event.count
  }
}
