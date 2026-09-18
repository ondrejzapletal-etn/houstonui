/**
 * UnreadCountService
 *
 * Fetches and caches unread message counts for all connected connectors.
 *
 * Design:
 *  - On-demand fetch: `fetchForUser(userId, type)` or `fetchAllForUser(userId)`.
 *  - Periodic background refresh every 5 minutes for all ACTIVE credentials.
 *  - Results are cached in `connector_credentials.unreadCount` column so that
 *    the status endpoint can return counts without making live API calls.
 *  - Individual connector failures are isolated – one failing connector does
 *    not block the others.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConnectorType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { GmailService } from './gmail/gmail.service'
import { SlackService } from './slack/slack.service'
import { AuditService } from '../audit/audit.service'

const PERIODIC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Connectors that expose an "unread count" metric.
 * Jira is intentionally excluded – it surfaces worklogs instead.
 */
const CONNECTORS_WITH_UNREAD_COUNT = new Set<ConnectorType>([
  ConnectorType.GMAIL,
  ConnectorType.SLACK,
])

export interface UnreadCountResult {
  type: ConnectorType
  unreadCount: number | null
  fetchedAt: Date | null
  error?: string
}

@Injectable()
export class UnreadCountService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnreadCountService.name)
  private periodicTimer?: ReturnType<typeof setInterval>

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly slack: SlackService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Start the periodic background refresh
    this.periodicTimer = setInterval(() => {
      void this.refreshAllActiveCredentials()
    }, PERIODIC_INTERVAL_MS)
    this.logger.log(
      `UnreadCountService: periodic refresh every ${PERIODIC_INTERVAL_MS / 1000}s started`,
    )
  }

  onModuleDestroy(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
    }
  }

  /**
   * Fetch the unread count for a single user + connector on demand.
   * Updates the cache in DB.
   */
  async fetchForUser(
    userId: string,
    type: ConnectorType,
    forceRefresh = false,
  ): Promise<UnreadCountResult> {
    try {
      const count = await this.fetchCount(userId, type, forceRefresh)
      await this.cacheCount(userId, type, count)
      this.audit.log('connector.unread.fetched', {
        userId,
        connectorType: type,
        metadata: { outcome: 'success', unreadCount: count },
      })
      return { type, unreadCount: count, fetchedAt: new Date() }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Unread fetch failed for user=${userId} type=${type}: ${errorMessage}`)
      this.audit.log('connector.unread.fetch_failed', {
        userId,
        connectorType: type,
        metadata: { outcome: 'failure', errorMessage },
      })
      return { type, unreadCount: null, fetchedAt: null, error: errorMessage }
    }
  }

  /**
   * Fetch unread counts for all connectors of the given user on demand.
   */
  async fetchAllForUser(userId: string): Promise<UnreadCountResult[]> {
    const credentials = await this.prisma.connectorCredential.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { connectorType: true },
    })

    return Promise.all(credentials.map((c) => this.fetchForUser(userId, c.connectorType)))
  }

  /**
   * Return cached unread counts for a user (no live fetch).
   */
  async getCached(userId: string): Promise<UnreadCountResult[]> {
    const records = await this.prisma.connectorCredential.findMany({
      where: { userId },
      select: {
        connectorType: true,
        unreadCount: true,
        unreadCountFetchedAt: true,
        status: true,
      },
    })

    return records.map((r) => ({
      type: r.connectorType,
      unreadCount: r.unreadCount ?? null,
      fetchedAt: r.unreadCountFetchedAt ?? null,
    }))
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchCount(
    userId: string,
    type: ConnectorType,
    forceRefresh = false,
  ): Promise<number> {
    switch (type) {
      case ConnectorType.GMAIL: {
        const result = await this.gmail.getUnreadCount(userId)
        return result.unreadCount
      }
      case ConnectorType.SLACK: {
        const result = await this.slack.getUnreadCount(userId, forceRefresh)
        return result.total
      }
      default:
        throw new Error(`Unread count not supported for connector type: ${String(type)}`)
    }
  }

  private async cacheCount(userId: string, type: ConnectorType, count: number): Promise<void> {
    await this.prisma.connectorCredential.updateMany({
      where: { userId, connectorType: type },
      data: {
        unreadCount: count,
        unreadCountFetchedAt: new Date(),
      },
    })
  }

  /**
   * Background periodic refresh: iterate all ACTIVE credentials and refresh each.
   * Errors per-credential are swallowed so one bad connector doesn't break others.
   */
  private async refreshAllActiveCredentials(): Promise<void> {
    this.logger.debug('UnreadCountService: starting periodic refresh')

    const activeCredentials = await this.prisma.connectorCredential
      .findMany({
        where: { status: 'ACTIVE' },
        select: { userId: true, connectorType: true },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to query active credentials: ${String(err)}`)
        return [] as { userId: string; connectorType: ConnectorType }[]
      })

    // Only refresh connectors that expose unread counts (Jira uses worklogs instead)
    const refreshable = activeCredentials.filter((c) =>
      CONNECTORS_WITH_UNREAD_COUNT.has(c.connectorType),
    )


    let refreshed = 0
    let failed = 0
    const MAX_PARALLEL = 2
    let idx = 0
    // Simple PromisePool implementation s náhodným zpožděním
    await new Promise<void>((resolve) => {
      let running = 0
      let finished = 0
      const total = refreshable.length
      const next = () => {
        if (idx >= total) {
          if (running === 0) resolve()
          return
        }
        const { userId, connectorType } = refreshable[idx++]
        running++
        (async () => {
          // Náhodné zpoždění 0–2 minuty (0–120000 ms)
          const delay = Math.floor(Math.random() * 120000)
          await new Promise((r) => setTimeout(r, delay))
          try {
            const count = await this.fetchCount(userId, connectorType)
            await this.cacheCount(userId, connectorType, count)
            refreshed++
          } catch (err: unknown) {
            failed++
            this.logger.warn(
              `Periodic refresh failed for user=${userId} type=${connectorType}: ${String(err)}`,
            )
          } finally {
            running--
            finished++
            if (idx < total) next()
            else if (running === 0) resolve()
          }
        })()
      }
      // Start initial batch
      for (let i = 0; i < Math.min(MAX_PARALLEL, total); i++) next()
    })

    this.logger.log(
      `UnreadCountService: periodic refresh done – refreshed=${refreshed} failed=${failed}`,
    )
  }
}
