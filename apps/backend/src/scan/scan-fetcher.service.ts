/**
 * ScanFetcherService
 *
 * Fetches data from all connected sources in parallel.
 * Each source is wrapped in a try-catch so a single connector failure
 * does NOT abort the scan (fail-safe per source).
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GmailService, GmailScanEmail } from '../connectors/gmail/gmail.service'
import { SlackService, SlackScanResult } from '../connectors/slack/slack.service'
import { CalendarService, CalendarEventsResult } from '../connectors/calendar/calendar.service'
import { JiraService, JiraWorklogsResult } from '../connectors/jira/jira.service'
import { ClockifyService, ClockifyWorklogsResult } from '../connectors/clockify/clockify.service'

export interface ScanSourceData {
  gmail: { emails: GmailScanEmail[]; error?: string }
  slack: { result: SlackScanResult; error?: string }
  calendar: { result: CalendarEventsResult; error?: string }
  jiraToday: { result: JiraWorklogsResult | null; error?: string }
  clockify: { result: ClockifyWorklogsResult | null; error?: string }
}

/** Hard cap per source – prevents one slow/rate-limited connector from blocking the response. */
const SOURCE_TIMEOUT_MS = 5_000

/** Slack needs extra time due to per-channel 1300ms throttling (up to 15 channels). */
const SLACK_TIMEOUT_MS = 90_000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Race a promise against a timeout.
 * On timeout, resolves with the provided fallback value instead of rejecting.
 */
function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

@Injectable()
export class ScanFetcherService {
  private readonly logger = new Logger(ScanFetcherService.name)

  constructor(
    private readonly gmail: GmailService,
    private readonly slack: SlackService,
    private readonly calendar: CalendarService,
    private readonly jira: JiraService,
    private readonly clockify: ClockifyService,
    private readonly config: ConfigService,
  ) {}

  async fetchAll(userId: string): Promise<ScanSourceData> {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)

    const timeoutError = 'Source timed out – will retry on next refresh'

    const [gmail, slack, calendar, jiraToday, clockify] = await Promise.all([
      withTimeout(this.safeGmail(userId), { emails: [], error: timeoutError }, SOURCE_TIMEOUT_MS),
      withTimeout(this.safeSlack(userId), { result: { channels: [], answeredMessages: [] }, error: timeoutError }, SLACK_TIMEOUT_MS),
      withTimeout(this.safeCalendar(userId, todayStart, tomorrowEnd), { result: { events: [] }, error: timeoutError }, SOURCE_TIMEOUT_MS),
      withTimeout(this.safeJira(userId, now.getFullYear(), now.getMonth() + 1), { result: null, error: timeoutError }, SOURCE_TIMEOUT_MS),
      withTimeout(this.safeClockify(userId, now.getFullYear(), now.getMonth() + 1), { result: null, error: timeoutError }, SOURCE_TIMEOUT_MS),
    ])

    return { gmail, slack, calendar, jiraToday, clockify }
  }

  private async safeGmail(userId: string): Promise<ScanSourceData['gmail']> {
    try {
      const emails = await this.gmail.fetchScanEmails(userId)
      const ageThresholdDays = parseAgeThresholdDays(
        this.config.get<string>('SCAN_MESSAGE_AGE_THRESHOLD_DAYS'),
      )
      const cutoff = Date.now() - ageThresholdDays * DAY_MS
      const enrichedEmails = await Promise.all(emails.map(async (email) => {
        if (!email.threadId || !isOlderThan(email.receivedAt, cutoff)) return email
        try {
          const activity = await this.gmail.getThreadActivity(userId, email.threadId, email.receivedAt)
          return { ...email, resolution: activity.resolution, threadContext: activity.context }
        } catch (err: unknown) {
          this.logger.warn(`Gmail thread check failed for user=${userId}: ${err instanceof Error ? err.message : String(err)}`)
          return { ...email, resolution: 'unknown' as const }
        }
      }))
      this.logger.debug(`Gmail: ${enrichedEmails.length} unread emails for user=${userId}`)
      return { emails: enrichedEmails }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Gmail fetch failed for user=${userId}: ${error}`)
      return { emails: [], error }
    }
  }

  private async safeSlack(userId: string): Promise<ScanSourceData['slack']> {
    try {
      const result = await this.slack.fetchScanMessages(userId)
      const total = result.channels.reduce((s, c) => s + c.messages.length, 0)
      this.logger.debug(`Slack: ${total} messages across ${result.channels.length} channels for user=${userId}`)
      return { result }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Slack fetch failed for user=${userId}: ${error}`)
      return { result: { channels: [], answeredMessages: [] }, error }
    }
  }

  private async safeCalendar(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<ScanSourceData['calendar']> {
    try {
      const result = await this.calendar.getEvents(userId, from, to)
      this.logger.debug(`Calendar: ${result.events.length} events for user=${userId}`)
      return { result }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Calendar fetch failed for user=${userId}: ${error}`)
      return { result: { events: [] }, error }
    }
  }

  private async safeJira(userId: string, year: number, month: number): Promise<ScanSourceData['jiraToday']> {
    try {
      const result = await this.jira.getWorklogs(userId, year, month)
      return { result }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Jira fetch failed for user=${userId}: ${error}`)
      return { result: null, error }
    }
  }

  private async safeClockify(userId: string, year: number, month: number): Promise<ScanSourceData['clockify']> {
    try {
      const result = await this.clockify.getWorklogs(userId, year, month)
      return { result }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Clockify fetch failed for user=${userId}: ${error}`)
      return { result: null, error }
    }
  }
}

function parseAgeThresholdDays(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : 14
}

function isOlderThan(timestamp: string, cutoff: number): boolean {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) && parsed < cutoff
}
