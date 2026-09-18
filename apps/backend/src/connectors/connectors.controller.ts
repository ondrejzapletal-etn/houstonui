/**
 * ConnectorsController
 *
 * REST endpoints for the OAuth 2.0 Authorization Code + PKCE flow,
 * connector lifecycle management, and connection status with unread counts.
 *
 * Routes:
 *   GET  /connectors
 *     → List all connectors for the authenticated user with status + cached unread counts.
 *
 *   POST /connectors/:type/connect
 *     → OAuth: returns authorization URL; desktop opens it in system browser.
 *     → Clockify: accepts { apiKey, workspaceId? } in body and stores API key directly.
 *     → Requires authentication (JWT).
 *
 *   GET  /connectors/:type/callback
 *     → OAuth provider redirect target (public, no JWT required).
 *     → Validates state + PKCE, exchanges code, persists tokens.
 *
 *   POST /connectors/:type/disconnect
 *     → Revoke + delete tokens, mark credential REVOKED.
 *     → Requires authentication.
 *
 *   POST /connectors/:type/refresh-unread
 *     → On-demand unread count refresh for one connector.
 *
 * Security:
 *  - OAuth callback is @Public so the provider can redirect without JWT.
 *    State token + PKCE ensure the callback cannot be replayed or hijacked.
 *  - No token values are ever surfaced in any response.
 *  - All events are audited via AuditService.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ConnectorType } from '@prisma/client'
import { Public } from '../auth/public.decorator'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ConnectorTypeParam } from './connector-type.pipe'
import { ConnectorsService } from './connectors.service'
import { UnreadCountService } from './unread-count.service'
import { JiraService, JiraUnauthorizedError } from './jira/jira.service'
import { UsersService } from '../users/users.service'
import { TimeSavedService } from '../users/time-saved.service'
import { AddWorklogDto } from './jira/add-worklog.dto'
import { UpdateWorklogDto } from './jira/update-worklog.dto'
import { ClockifyAddWorklogDto } from './clockify/add-worklog.dto'
import { ClockifyService } from './clockify/clockify.service'
import { HotSpotConnectDto } from './hotspot/hotspot-connect.dto'
import { HotSpotService } from './hotspot/hotspot.service'
import { ConfigService } from '@nestjs/config'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { CalendarService } from './calendar/calendar.service'
import { GmailService } from './gmail/gmail.service'
import { SlackService } from './slack/slack.service'
import { validateSync } from 'class-validator'

@Controller('connectors')
export class ConnectorsController {
  private readonly logger = new Logger(ConnectorsController.name)
  private static readonly JIRA_WORKLOG_STATS_CACHE_TTL_MS = 15 * 60 * 1000

  constructor(
    private readonly connectors: ConnectorsService,
    private readonly unreadCounts: UnreadCountService,
    private readonly jira: JiraService,
    private readonly users: UsersService,
    private readonly timeSaved: TimeSavedService,
    private readonly clockify: ClockifyService,
    private readonly hotSpot: HotSpotService,
    private readonly config: ConfigService,
    private readonly knowledge: KnowledgeService,
    private readonly calendar: CalendarService,
    private readonly gmail: GmailService,
    private readonly slack: SlackService,
  ) {}

  // ─── GET /connectors ───────────────────────────────────────────────────────

  /**
   * Returns all connectors for the authenticated user with:
   *  - Connection status (connected | not_connected | token_expired | error)
   *  - Cached unread counts (null if not yet fetched or connector not connected)
   *  - ISO-8601 timestamp of the last successful unread count refresh
   *
   * Counts are served from the DB cache to keep this endpoint fast.
   * Use POST /:type/refresh-unread to force a live refresh.
   *
   * Response: { success: true, data: { connectors: ConnectorInfo[] } }
   */
  @Get()
  async listConnectors(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user, 'listConnectors')
    const data = await this.connectors.listConnectorsInfo(userId)
    const hotSpot = data.connectors.find((connector) => connector.id === 'hotspot')
    if (hotSpot?.status === 'connected' && !(await this.hotSpot.isInternalNetworkAvailable(userId))) {
      hotSpot.status = 'warning'
      hotSpot.unreadCount = null
      hotSpot.lastCheckedAt = null
      hotSpot.errorMessage = 'Interní síť není dostupná, připoj se na VPN'
    }
    return { success: true, data }
  }

  // ─── POST /connectors/:type/connect ───────────────────────────────────────

  /**
   * Initiate the OAuth PKCE flow.
   * Returns the authorization URL that the desktop app must open in the system browser.
   */
  @Post(':type/connect')
  @HttpCode(HttpStatus.OK)
  async initiateConnect(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) type: ConnectorType,
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const userId = this.resolveUserId(user, 'initiateConnect')

    // Clockify uses API key authentication, not OAuth.
    // The body contains { apiKey, workspaceId? } instead of an auth redirect.
    if (type === ConnectorType.CLOCKIFY) {
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (!apiKey) {
        throw new BadRequestException('apiKey is required for Clockify connection')
      }
      if (apiKey.length > 128) {
        throw new BadRequestException('apiKey must not exceed 128 characters')
      }
      const workspaceId =
        typeof body.workspaceId === 'string' ? body.workspaceId.trim() || undefined : undefined
      await this.clockify.connectWithApiKey(userId, apiKey, workspaceId)
      return { success: true, data: { message: 'connected' } }
    }

    if (type === ConnectorType.HOTSPOT) {
      const dto = Object.assign(new HotSpotConnectDto(), body)
      const validationErrors = validateSync(dto)
      if (validationErrors.length > 0) {
        throw new BadRequestException('A valid apiKey and employeeId are required for HOT SPOT connection')
      }
      await this.hotSpot.connectWithApiKey(userId, dto.apiKey.trim(), dto.employeeId.trim())
      return { success: true, data: { message: 'connected' } }
    }

    const ipAddress = this.extractIp(req)
    return this.connectors.initiateConnect(userId, type, ipAddress)
  }

  // ─── GET /connectors/:type/callback ───────────────────────────────────────

  /**
   * OAuth provider redirect target. Marked @Public – no JWT required.
   * On success, renders a HTML page that closes itself / signals the desktop app.
   * On error, renders an error page.
   */
  @Get(':type/callback')
  @Public() // KEEP-PUBLIC: provider redirect target, guarded by single-use state + PKCE
  async handleCallback(
    @Param('type', ConnectorTypeParam) type: ConnectorType,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      this.logger.warn(`OAuth callback provider error: ${error} for type=${type}`)
      res
        .status(HttpStatus.BAD_REQUEST)
        .send(this.buildCallbackPage('error', type, `Provider error: ${error}`))
      return
    }

    if (!code || !state) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .send(this.buildCallbackPage('error', type, 'Missing code or state parameter.'))
      return
    }

    try {
      const ipAddress = this.extractIp(req)
      const result = await this.connectors.handleCallback(code, state, ipAddress)

      // Never log token values here – only the resolved identity and connector.
      this.logger.log(
        `OAuth callback completed: userId=${result.userId} connector=${result.connectorType}`,
      )

      res.send(this.buildCallbackPage('success', type))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error(`OAuth callback error for type=${type}: ${message}`)
      res.status(HttpStatus.BAD_REQUEST).send(this.buildCallbackPage('error', type, message))
    }
  }

  // ─── POST /connectors/:type/disconnect ────────────────────────────────────

  /**
   * Revoke the connector credential for the authenticated user.
   * Deletes the token from Key Vault and marks the DB record REVOKED.
   */
  @Post(':type/disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) type: ConnectorType,
    @Req() req: Request,
  ): Promise<void> {
    const userId = this.resolveUserId(user, 'disconnect')
    const ipAddress = this.extractIp(req)
    await this.connectors.disconnect(userId, type, ipAddress)
  }

  // ─── POST /connectors/:type/refresh-unread ────────────────────────────────

  /**
   * Force an immediate live unread count refresh for the given connector.
   * Updates the DB cache and returns the fresh count.
   */
  @Post(':type/refresh-unread')
  @HttpCode(HttpStatus.OK)
  async refreshUnread(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) type: ConnectorType,
  ) {
    const userId = this.resolveUserId(user, 'refreshUnread')
    await this.unreadCounts.fetchForUser(userId, type, true)
    const data = await this.connectors.listConnectorsInfo(userId)
    const connector = data.connectors.find((item) => item.id === type.toLowerCase())
    if (!connector) {
      throw new NotFoundException(`Connector not found: ${type}`)
    }
    return { success: true, data: connector }
  }

  // ─── GET /connectors/jira/worklogs ────────────────────────────────────────

  /**
   * Returns per-day logged seconds for the authenticated user for the given month.
   * Defaults to the current calendar month when year/month are omitted.
   *
   * Response: { success: true, data: { year, month, secondsPerDay } }
   *
   * secondsPerDay is a sparse map: only days with logged time are present.
   * Days with no worklogs are absent (treat as 0 on the frontend).
   */
  @Get('jira/worklogs')
  async getJiraWorklogs(
    @CurrentUser() user: CurrentUserData,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
  ) {
    const userId = this.resolveUserId(user, 'getJiraWorklogs')
    const now = new Date()
    const resolvedYear = year ?? now.getFullYear()
    const resolvedMonth = month ?? now.getMonth() + 1
    try {
      const result = await this.wrapJira(() => this.jira.getWorklogs(userId, resolvedYear, resolvedMonth))
      return {
        success: true,
        data: { year: resolvedYear, month: resolvedMonth, secondsPerDay: result.secondsPerDay },
      }
    } catch (err: unknown) {
      // If the Jira credential is invalid (not connected / re-auth required) return
      // an empty sparse map so the frontend can continue to function without a 422.
      // Keep the original error for other cases via wrapJira.
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`getJiraWorklogs: returning empty result due to Jira credential issue: ${msg}`)
      return { success: true, data: { year: resolvedYear, month: resolvedMonth, secondsPerDay: {} } }
    }
  }

  @Get('jira/worklogs/stats')
  async getJiraWorklogStats(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user, 'getJiraWorklogStats')
    const cached = await this.users.getCachedJiraWorklogStats(userId)
    if (
      cached &&
      Date.now() - cached.updatedAt.getTime() < ConnectorsController.JIRA_WORKLOG_STATS_CACHE_TTL_MS
    ) {
      return { success: true, data: { count: cached.count, seconds: cached.seconds } }
    }

    try {
      const result = await this.wrapJira(() => this.jira.getAllWorklogStats(userId))
      await this.users.cacheJiraWorklogStats(userId, result.count, result.seconds)
      return { success: true, data: result }
    } catch (error: unknown) {
      if (cached) {
        this.logger.warn(`getJiraWorklogStats: using stale cache due to Jira error: ${String(error)}`)
        return { success: true, data: { count: cached.count, seconds: cached.seconds } }
      }
      throw error
    }
  }

  // ─── POST /connectors/jira/worklogs ───────────────────────────────────────

  /**
   * Adds a worklog entry to a Jira issue on behalf of the authenticated user.
   *
   * Request body (JSON):
   *   { issueKey: "PROJ-123", date: "2026-05-11", timeSpentSeconds: 3600, comment?: "..." }
   *
   * Response: { success: true, data: { worklogId, started, timeSpentSeconds } }
   */
  @Post('jira/worklogs')
  @HttpCode(HttpStatus.CREATED)
  async addJiraWorklog(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: AddWorklogDto,
  ) {
    const userId = this.resolveUserId(user, 'addJiraWorklog')
    const result = await this.wrapJira(() =>
      this.jira.addWorklog(userId, dto.issueKey, dto.date, dto.timeSpentSeconds, dto.comment),
    )

    // Persist aggregated worklog stats on the user record (count + seconds).
    try {
      await this.users.incrementWorklogs(userId, dto.timeSpentSeconds)
    } catch (err) {
      this.logger.warn(`Failed to persist worklog stats for user=${userId}: ${(err as Error).message}`)
    }
    void this.timeSaved.record(userId, 'worklog')

    // Knowledge graph: ensure task entity exists and append worklog event
    void this.syncJiraTaskToKg(userId, dto.issueKey, dto.date, dto.timeSpentSeconds)

    return { success: true, data: result }
  }

  // ─── PUT /connectors/jira/worklogs/:worklogId ────────────────────────────

  @Put('jira/worklogs/:worklogId')
  @HttpCode(HttpStatus.OK)
  async updateJiraWorklog(
    @CurrentUser() user: CurrentUserData,
    @Param('worklogId') worklogId: string,
    @Body() dto: UpdateWorklogDto,
  ) {
    if (!worklogId) throw new BadRequestException('worklogId is required')
    const userId = this.resolveUserId(user, 'updateJiraWorklog')
    const result = await this.wrapJira(() =>
      this.jira.updateWorklog(userId, worklogId, dto.issueKey, dto.date, dto.timeSpentSeconds, dto.comment),
    )

    if (dto.oldTimeSpentSeconds != null) {
      const delta = dto.timeSpentSeconds - dto.oldTimeSpentSeconds
      try {
        await this.users.adjustWorklogSeconds(userId, delta)
      } catch (err) {
        this.logger.warn(`Failed to adjust worklog seconds for user=${userId}: ${(err as Error).message}`)
      }
    }

    return { success: true, data: result }
  }

  // ─── DELETE /connectors/jira/worklogs/:worklogId ─────────────────────────

  @Delete('jira/worklogs/:worklogId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteJiraWorklog(
    @CurrentUser() user: CurrentUserData,
    @Param('worklogId') worklogId: string,
    @Query('issueKey') issueKey: string,
    @Query('oldTimeSpentSeconds') oldTimeSpentSecondsStr?: string,
  ): Promise<void> {
    if (!worklogId) throw new BadRequestException('worklogId is required')
    if (!issueKey) throw new BadRequestException('issueKey query param is required')
    const userId = this.resolveUserId(user, 'deleteJiraWorklog')
    await this.wrapJira(() => this.jira.deleteWorklog(userId, worklogId, issueKey))

    if (oldTimeSpentSecondsStr) {
      const oldSeconds = parseInt(oldTimeSpentSecondsStr, 10)
      if (!isNaN(oldSeconds) && oldSeconds > 0) {
        try {
          await this.users.decrementWorklogs(userId, oldSeconds)
        } catch (err) {
          this.logger.warn(`Failed to decrement worklog stats for user=${userId}: ${(err as Error).message}`)
        }
      }
    }
  }

  // ─── GET /connectors/clockify/worklogs ───────────────────────────────────

  @Get('hotspot/vacation')
  async getHotSpotVacation(
    @CurrentUser() user: CurrentUserData,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @Query('workingDayHours', ParseIntPipe) workingDayHours: number,
  ) {
    if (month < 1 || month > 12 || workingDayHours < 1 || workingDayHours > 24) {
      throw new BadRequestException('Invalid month or workingDayHours')
    }
    const userId = this.resolveUserId(user, 'getHotSpotVacation')
    const seconds = await this.hotSpot.getVacationSeconds(userId, year, month, workingDayHours)
    return { success: true, data: { year, month, seconds } }
  }

  // ─── GET /connectors/clockify/worklogs ───────────────────────────────────

  /**
   * Returns per-day logged seconds from Clockify for the given month.
   * Defaults to the current calendar month when year/month are omitted.
   *
   * Response: { success: true, data: { year, month, secondsPerDay } }
   */
  @Get('clockify/worklogs')
  async getClockifyWorklogs(
    @CurrentUser() user: CurrentUserData,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
  ) {
    const userId = this.resolveUserId(user, 'getClockifyWorklogs')
    const now = new Date()
    const resolvedYear = year ?? now.getFullYear()
    const resolvedMonth = month ?? now.getMonth() + 1
    const result = await this.clockify.getWorklogs(userId, resolvedYear, resolvedMonth)
    return {
      success: true,
      data: { year: resolvedYear, month: resolvedMonth, secondsPerDay: result.secondsPerDay },
    }
  }

  // ─── POST /connectors/clockify/worklogs ─────────────────────────────────

  @Post('clockify/worklogs')
  @HttpCode(HttpStatus.CREATED)
  async addClockifyWorklog(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ClockifyAddWorklogDto,
  ) {
    const userId = this.resolveUserId(user, 'addClockifyWorklog')
    const result = await this.clockify.addWorklog(
      userId,
      dto.date,
      dto.timeSpentSeconds,
      dto.comment,
      dto.issueKey,
      dto.projectId,
    )

    try {
      await this.users.incrementWorklogs(userId, dto.timeSpentSeconds)
    } catch (err) {
      this.logger.warn(`Failed to persist Clockify worklog stats for user=${userId}: ${(err as Error).message}`)
    }
    void this.timeSaved.record(userId, 'worklog')

    return { success: true, data: result }
  }

  // ─── GET /connectors/worklogs/monthly-issues ────────────────────────────

  /**
   * Returns aggregated month totals grouped by Jira issues and Clockify issue-like items.
   *
   * Response: { success: true, data: { year, month, issues } }
   */
  @Get('worklogs/monthly-issues')
  async getMonthlyWorklogIssues(
    @CurrentUser() user: CurrentUserData,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('month', new ParseIntPipe({ optional: true })) month?: number,
  ) {
    const userId = this.resolveUserId(user, 'getMonthlyWorklogIssues')
    const now = new Date()
    const resolvedYear = year ?? now.getFullYear()
    const resolvedMonth = month ?? now.getMonth() + 1

    let jiraIssues: Array<{
      source: 'jira'
      reference: string
      title?: string
      totalSeconds: number
      jiraIssueKey: string
    }> = []
    try {
      const result = await this.wrapJira(() =>
        this.jira.getWorklogIssuesForMonth(userId, resolvedYear, resolvedMonth),
      )
      jiraIssues = result.map((item) => ({
        source: 'jira',
        reference: item.issueId,
        title: item.issueName,
        totalSeconds: item.totalSeconds,
        jiraIssueKey: item.issueId,
      }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(
        `getMonthlyWorklogIssues: Jira issues unavailable, returning empty Jira segment: ${msg}`,
      )
    }

    let clockifyIssues: Array<{
      source: 'clockify'
      reference: string
      clockifyProjectId?: string
      title?: string
      totalSeconds: number
      jiraIssueKey?: string
    }> = []
    try {
      const result = await this.clockify.getWorklogIssuesForMonth(userId, resolvedYear, resolvedMonth)
      clockifyIssues = result.map((item) => ({
        source: 'clockify',
        reference: item.project || 'Clockify',
        clockifyProjectId: item.project,
        title: item.description,
        totalSeconds: item.totalSeconds,
        jiraIssueKey: item.jiraIssueKey,
      }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(
        `getMonthlyWorklogIssues: Clockify issues unavailable, returning empty Clockify segment: ${msg}`,
      )
    }

    const extractProjectKey = (value: string | undefined): string => {
      if (!value) return '~~~~'
      const match = value.toUpperCase().match(/^([A-Z][A-Z0-9_]*)-\d+$/)
      if (match?.[1]) return match[1]
      return '~~~~'
    }

    const issues = [...jiraIssues, ...clockifyIssues].sort((a, b) => {
      const aProjectKey = extractProjectKey(a.jiraIssueKey ?? a.reference)
      const bProjectKey = extractProjectKey(b.jiraIssueKey ?? b.reference)

      if (aProjectKey !== bProjectKey) {
        return aProjectKey.localeCompare(bProjectKey)
      }

      const aSecondary = (a.jiraIssueKey ?? a.reference).toUpperCase()
      const bSecondary = (b.jiraIssueKey ?? b.reference).toUpperCase()
      return aSecondary.localeCompare(bSecondary)
    })

    return {
      success: true,
      data: {
        year: resolvedYear,
        month: resolvedMonth,
        issues,
      },
    }
  }

  // ─── GET /connectors/worklogs/monthly-issues/:source/:reference ──────────

  @Get('worklogs/monthly-issues/:source/:reference')
  async getWorklogsByIssue(
    @CurrentUser() user: CurrentUserData,
    @Param('source') source: string,
    @Param('reference') reference: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    if (source !== 'jira' && source !== 'clockify') {
      throw new BadRequestException('Invalid worklog source')
    }
    if (month < 1 || month > 12) {
      throw new BadRequestException('Invalid month')
    }

    const userId = this.resolveUserId(user, 'getWorklogsByIssue')

    if (source === 'jira') {
      try {
        const entries = await this.wrapJira(() =>
          this.jira.getWorklogEntriesForIssueInMonth(userId, year, month, reference),
        )
        return {
          success: true,
          data: {
            year,
            month,
            source,
            reference,
            worklogs: entries.map((entry) => ({
              source: 'jira' as const,
              id: entry.id,
              issueId: entry.issueId,
              issueName: entry.issueName,
              started: entry.started,
              timeSpentSeconds: entry.timeSpentSeconds,
              comment: entry.comment,
              description: entry.comment,
            })),
          },
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`getWorklogsByIssue: returning empty result due to Jira credential issue: ${msg}`)
        return {
          success: true,
          data: { year, month, source, reference, worklogs: [] },
        }
      }
    }

    const entries = await this.clockify.getWorklogEntriesForIssueInMonth(
      userId,
      year,
      month,
      reference,
    )
    return {
      success: true,
      data: {
        year,
        month,
        source,
        reference,
        worklogs: entries.map((entry) => ({
          source: 'clockify' as const,
          ...entry,
        })),
      },
    }
  }

  // ─── GET /connectors/jira/worklogs/day ────────────────────────────────────

  /**
   * Returns detailed worklog entries for a specific date (lazy-loaded on demand).
   * Uses a single JQL search; returns issue keys, times and comments.
   *
   * Response: { success: true, data: { date, worklogs: JiraWorklogDayEntry[] } }
   */
  @Get('jira/worklogs/day')
  async getJiraWorklogsDay(
    @CurrentUser() user: CurrentUserData,
    @Query('date') date: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('Invalid date format, expected YYYY-MM-DD')
    }
    const userId = this.resolveUserId(user, 'getJiraWorklogsDay')
    try {
      const worklogs = await this.wrapJira(() => this.jira.getWorklogEntriesForDay(userId, date))
      return { success: true, data: { date, worklogs } }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`getJiraWorklogsDay: returning empty result due to Jira credential issue: ${msg}`)
      return { success: true, data: { date, worklogs: [] } }
    }
  }

  // ─── GET /connectors/clockify/worklogs/day ────────────────────────────────

  /**
   * Returns detailed Clockify time entries for a specific date (lazy-loaded on demand).
   *
   * Response: { success: true, data: { date, worklogs: ClockifyWorklogDayEntry[] } }
   */
  @Get('clockify/worklogs/day')
  async getClockifyWorklogsDay(
    @CurrentUser() user: CurrentUserData,
    @Query('date') date: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('Invalid date format, expected YYYY-MM-DD')
    }
    const userId = this.resolveUserId(user, 'getClockifyWorklogsDay')
    const worklogs = await this.clockify.getWorklogEntriesForDay(userId, date)
    return { success: true, data: { date, worklogs } }
  }

  // ─── GET /connectors/calendar/event ──────────────────────────────────────

  @Get('calendar/event')
  async getCalendarEvent(
    @CurrentUser() user: CurrentUserData,
    @Query('id') id: string,
  ) {
    if (!id) {
      throw new BadRequestException('id query parameter is required')
    }
    const userId = this.resolveUserId(user, 'getCalendarEvent')
    try {
      const ev = await this.calendar.getEvent(userId, id)
      return { success: true, data: { event: ev } }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`getCalendarEvent: returning empty result due to calendar error: ${msg}`)
      return { success: true, data: { event: null } }
    }
  }

  // ─── GET /connectors/calendar/events ─────────────────────────────────────

  @Get('calendar/events')
  async getCalendarEvents(
    @CurrentUser() user: CurrentUserData,
    @Query('timeMin') timeMin: string,
    @Query('timeMax') timeMax: string,
  ) {
    if (!timeMin || !timeMax) {
      throw new BadRequestException('timeMin and timeMax query parameters are required (ISO 8601)')
    }
    const tmin = new Date(timeMin)
    const tmax = new Date(timeMax)
    if (isNaN(tmin.getTime()) || isNaN(tmax.getTime())) {
      throw new BadRequestException('Invalid ISO date for timeMin or timeMax')
    }

    const userId = this.resolveUserId(user, 'getCalendarEvents')
    try {
      const result = await this.calendar.getEvents(userId, tmin, tmax)
      return { success: true, data: result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`getCalendarEvents: returning empty result due to calendar error: ${msg}`)
      return { success: true, data: { events: [] } }
    }
  }

  // ─── GET /connectors/daily-activity ──────────────────────────────────────

  /**
   * Returns sent Gmail emails and sent Slack messages for a given date.
   * Used by the Worklog Details Modal to suggest worklog entries.
   * Missing connectors silently return empty arrays.
   *
   * Response: { success: true, data: { sentEmails, sentSlackMessages } }
   */
  @Get('daily-activity')
  async getDailyActivity(
    @CurrentUser() user: CurrentUserData,
    @Query('date') date: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('Invalid date format, expected YYYY-MM-DD')
    }
    const userId = this.resolveUserId(user, 'getDailyActivity')

    const [emailsResult, slackResult] = await Promise.allSettled([
      this.gmail.fetchSentEmailsForDay(userId, date),
      this.slack.fetchSentMessagesForDay(userId, date),
    ])

    const sentEmails = emailsResult.status === 'fulfilled' ? emailsResult.value : []
    const sentSlackMessages = slackResult.status === 'fulfilled' ? slackResult.value : []

    if (emailsResult.status === 'rejected') {
      this.logger.warn(`getDailyActivity: Gmail failed for date=${date}: ${(emailsResult.reason as Error)?.message}`)
    }
    if (slackResult.status === 'rejected') {
      this.logger.warn(`getDailyActivity: Slack failed for date=${date}: ${(slackResult.reason as Error)?.message}`)
    }

    return { success: true, data: { sentEmails, sentSlackMessages } }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Find-or-create a KG task entity for the Jira issue, enrich it with full
   * issue details from the Jira API, and append a worklog_logged event.
   * Always fire-and-forget — never throws.
   */
  private async syncJiraTaskToKg(
    userId: string,
    issueKey: string,
    date: string,
    timeSpentSeconds: number,
  ): Promise<void> {
    try {
      // Resolve (find or create) the task entity
      const entity = await this.knowledge.resolveEntity(userId, 'jira', 'issue', issueKey, {
        type: 'task',
        title: issueKey,
      })

      // Append worklog event
      await this.knowledge.appendEventInternal(userId, entity.id, 'worklog_logged', {
        issueKey,
        date,
        timeSpentSeconds,
      })

      // Enrich with full Jira details
      const details = await this.jira.getIssueDetails(userId, issueKey)
      if (!details) return

      await this.knowledge.updateEntity(entity.id, userId, {
        title: details.summary,
        status: details.status,
      })

      const facts: Promise<void>[] = [
        this.knowledge.upsertFactInternal(entity.id, 'status', details.status, 'jira'),
        this.knowledge.upsertFactInternal(entity.id, 'source', 'jira', 'jira'),
        this.knowledge.upsertFactInternal(entity.id, 'jiraIssueKey', details.key, 'jira'),
        this.knowledge.upsertFactInternal(entity.id, 'summary', details.summary, 'jira'),
      ]
      if (details.priority) facts.push(this.knowledge.upsertFactInternal(entity.id, 'priority', details.priority, 'jira'))
      if (details.duedate) facts.push(this.knowledge.upsertFactInternal(entity.id, 'duedate', details.duedate, 'jira'))
      if (details.labels.length > 0) facts.push(this.knowledge.upsertFactInternal(entity.id, 'labels', details.labels.join(', '), 'jira'))

      for (const role of ['assignee', 'reporter'] as const) {
        const person = details[role]
        if (!person) continue
        facts.push(this.knowledge.upsertFactInternal(entity.id, role, person.displayName, 'jira'))
        facts.push(
          this.knowledge.resolveEntity(userId, 'jira', 'person', person.email, {
            type: 'person',
            title: person.displayName,
          }).then(async (p) => {
            await this.knowledge.upsertFactInternal(p.id, 'email', person.email, 'jira')
            await this.knowledge.createRelation(userId, {
              fromEntityId: entity.id,
              toEntityId: p.id,
              relationType: 'MENTIONS',
            }).catch(() => {})
          }),
        )
      }

      await Promise.all(facts)
      this.logger.debug(`KG task synced from worklog: ${issueKey}`)
    } catch (err) {
      this.logger.warn(`KG worklog sync failed ${issueKey}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Maps JiraUnauthorizedError → HTTP 401; lets all other errors propagate. */
  private async wrapJira<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err: unknown) {
      if (err instanceof JiraUnauthorizedError) {
        throw new UnauthorizedException('Jira token is invalid or expired. Please reconnect.')
      }
      throw err
    }
  }

  /**
   * Resolves the userId for a request.
   *
   * In production the JWT is always required and user is always present.
   * In development mode, endpoints decorated with @Public() may receive
   * unauthenticated requests; in that case we fall back to the seeded
   * dev-user-placeholder so the full flow can be exercised locally.
   *
   * TODO(DEV-ONLY): Remove the fallback before any non-development deployment.
   */
  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private resolveUserId(user: CurrentUserData, operation: string): string {
    if (user?.id) return user.id
    this.logger.error(`${operation}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  private toFrontendStatus(status: string): 'connected' | 'not_connected' | 'error' {
    if (status === 'ACTIVE') return 'connected'
    if (status === 'REVOKED') return 'not_connected'
    return 'error'
  }

  private extractIp(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim()
    return req.socket?.remoteAddress
  }

  /**
   * Simple HTML page shown in the browser after OAuth callback.
   * Works without any frontend assets.
   */
  private buildCallbackPage(
    outcome: 'success' | 'error',
    type: ConnectorType,
    errorMessage?: string,
  ): string {
    const label =
      type === ConnectorType.GMAIL
        ? 'Gmail'
        : type === ConnectorType.JIRA
          ? 'Jira'
          : 'Slack'
    const styles = `body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
      height:100vh;margin:0;background:#111}.card{background:#1a1a2e;color:#fff;border-radius:12px;
      padding:40px;text-align:center;max-width:400px}h1{margin-bottom:8px}p{color:#9ca3af}
      code{color:#fca5a5;font-size:.85em}`

    if (outcome === 'success') {
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Houston – ${label} Connected</title><style>${styles}</style></head>
<body><div class="card"><h1 style="color:#4ade80">✓ ${label} Connected</h1>
<p>You can close this window and return to Houston.</p>
<script>setTimeout(()=>window.close(),2000)</script></div></body></html>`
    }

    const safeMsg = errorMessage
      ? errorMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : ''

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Houston – Connection Failed</title><style>${styles}</style></head>
<body><div class="card"><h1 style="color:#f87171">✗ Connection Failed</h1>
<p>Could not connect your ${label} account.</p>
${safeMsg ? `<p><code>${safeMsg}</code></p>` : ''}
<p>Please close this window and try again in Houston.</p>
</div></body></html>`
  }
}
