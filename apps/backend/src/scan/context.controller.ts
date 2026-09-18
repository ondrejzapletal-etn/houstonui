/**
 * ContextController
 *
 * Routes:
 *   GET /api/v1/context – fetch aggregated context data from all connected sources
 *
 * Reuses ScanFetcherService.fetchAll() without triggering a full scan or
 * persisting anything in the DB. Data is returned directly as JSON.
 *
 * Security: requires authentication – the response aggregates the caller's
 * mail, Slack, calendar and worklog data.
 */

import { Controller, Get, Logger } from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ScanFetcherService } from './scan-fetcher.service'
import type { GmailScanEmail } from '../connectors/gmail/gmail.service'
import type { SlackScanResult } from '../connectors/slack/slack.service'
import type { CalendarEvent } from '../connectors/calendar/calendar.service'

interface ContextData {
  gmail: { emails: GmailScanEmail[]; error?: string }
  slack: { channels: SlackScanResult['channels']; error?: string }
  calendar: { events: CalendarEvent[]; error?: string }
  jira: { hoursToday: number; error?: string }
  clockify: { hoursToday: number; error?: string }
  fetchedAt: string
}

interface ContextResponse {
  success: true
  data: ContextData
}

@Controller('context')
export class ContextController {
  private readonly logger = new Logger(ContextController.name)

  constructor(private readonly fetcher: ScanFetcherService) {}

  /**
   * GET /api/v1/context
   * Returns aggregated context data from all connected sources.
   */
  @Get()
  async getContext(@CurrentUser() user: CurrentUserData): Promise<ContextResponse> {
    const userId = user.id
    this.logger.log(`GET /api/v1/context for user=${userId}`)

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)

    const sourceData = await this.fetcher.fetchAll(userId)

    const todayDay = now.getDate()
    const jiraSecsToday = sourceData.jiraToday.result?.secondsPerDay[todayDay] ?? 0
    const clockifySecsToday = sourceData.clockify.result?.secondsPerDay[todayDay] ?? 0

    const data: ContextData = {
      gmail: {
        emails: sourceData.gmail.emails,
        error: sourceData.gmail.error,
      },
      slack: {
        channels: sourceData.slack.result.channels,
        error: sourceData.slack.error,
      },
      calendar: {
        events: sourceData.calendar.result.events,
        error: sourceData.calendar.error,
      },
      jira: {
        hoursToday: parseFloat((jiraSecsToday / 3600).toFixed(2)),
        error: sourceData.jiraToday.error,
      },
      clockify: {
        hoursToday: parseFloat((clockifySecsToday / 3600).toFixed(2)),
        error: sourceData.clockify.error,
      },
      fetchedAt: now.toISOString(),
    }

    return { success: true, data }
  }
}
