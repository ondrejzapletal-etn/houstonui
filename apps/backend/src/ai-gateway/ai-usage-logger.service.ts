/**
 * Persists one row per AiGatewayService.chat() call and serves the daily/monthly
 * usage summary shown in Settings → AI model.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { costUsd } from './pricing'
import type { LlmProviderName, LlmQuality } from './providers/llm-provider.interface'
import { createReportRangeWindow, type ReportRange } from '../reporting/report-range'

export interface RecordUsageInput {
  userId: string
  provider: LlmProviderName
  model: string
  quality: LlmQuality
  inputTokens: number
  outputTokens: number
}

export interface AiUsageBucket {
  /** 'YYYY-MM-DD' for a daily bucket, 'YYYY-MM' for a monthly one. */
  period: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Sum of the calls with known pricing. Undercounts if hasUnknownPricing is true. */
  costUsd: number
  /** True if a call in this bucket used a model with no entry in the pricing table. */
  hasUnknownPricing: boolean
}

export interface AiUsageSummary {
  /** Last 7 days, oldest first, zero-filled for days with no usage. */
  daily: AiUsageBucket[]
  /** Last 3 months, oldest first, zero-filled for months with no usage. */
  monthly: AiUsageBucket[]
}

export interface AiUsageReport extends ReportRange {
  buckets: AiUsageBucket[]
}

const DAILY_DAYS = 7
const MONTHLY_MONTHS = 3

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function utcMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

function emptyBucket(period: string): AiUsageBucket {
  return { period, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, hasUnknownPricing: false }
}

@Injectable()
export class AiUsageLoggerService {
  private readonly logger = new Logger(AiUsageLoggerService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget from the caller's perspective: a logging failure must never
   * fail the LLM call it's recording, so this method catches and warns instead
   * of throwing.
   */
  async record(input: RecordUsageInput): Promise<void> {
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          userId: input.userId,
          provider: input.provider,
          model: input.model,
          quality: input.quality,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          costUsd: costUsd(input.model, input.inputTokens, input.outputTokens),
        },
      })
    } catch (err) {
      this.logger.warn(
        `Failed to record usage for user=${input.userId} model=${input.model}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async getSummary(userId: string): Promise<AiUsageSummary> {
    const now = new Date()

    // One query window covers both breakdowns: 3 months back always contains
    // the last 7 days too.
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHLY_MONTHS - 1), 1),
    )

    const logs = await this.prisma.aiUsageLog.findMany({
      where: { userId, createdAt: { gte: rangeStart } },
      select: { createdAt: true, inputTokens: true, outputTokens: true, costUsd: true },
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

    for (const log of logs) {
      this.accumulate(dailyBuckets, utcDayKey(log.createdAt), log)
      this.accumulate(monthlyBuckets, utcMonthKey(log.createdAt), log)
    }

    return {
      daily: dailyKeys.map((k) => dailyBuckets.get(k)!),
      monthly: monthlyKeys.map((k) => monthlyBuckets.get(k)!),
    }
  }

  async getReport(userId: string, range: ReportRange): Promise<AiUsageReport> {
    const window = createReportRangeWindow(range)
    const logs = await this.prisma.aiUsageLog.findMany({
      where: { userId, createdAt: { gte: window.fromDate, lt: window.toDateExclusive } },
      select: { createdAt: true, inputTokens: true, outputTokens: true, costUsd: true },
    })
    const buckets = new Map(window.periodKeys.map((key) => [key, emptyBucket(key)]))

    for (const log of logs) {
      const key = window.granularity === 'daily' ? utcDayKey(log.createdAt) : utcMonthKey(log.createdAt)
      this.accumulate(buckets, key, log)
    }

    return {
      from: range.from,
      to: range.to,
      granularity: range.granularity,
      buckets: window.periodKeys.map((key) => buckets.get(key)!),
    }
  }

  private accumulate(
    buckets: Map<string, AiUsageBucket>,
    key: string,
    log: { inputTokens: number; outputTokens: number; costUsd: number | null },
  ): void {
    // Only present for keys inside the requested window – a log just outside
    // the daily window but inside the monthly one legitimately has no bucket.
    const bucket = buckets.get(key)
    if (!bucket) return

    bucket.inputTokens += log.inputTokens
    bucket.outputTokens += log.outputTokens
    bucket.totalTokens += log.inputTokens + log.outputTokens
    if (log.costUsd === null) {
      bucket.hasUnknownPricing = true
    } else {
      bucket.costUsd += log.costUsd
    }
  }
}
