/**
 * ClockifyService
 *
 * Manages the Clockify API key credential lifecycle and fetches
 * per-day worklog totals for a connected user.
 *
 * Authentication:
 *  Clockify uses a simple API key (X-Api-Key header), not OAuth.
 *  The key is stored as `accessToken` in Key Vault; `refreshToken` is empty string.
 *  Keys do not expire, so no refresh logic is required.
 *
 * Storage conventions (parallel to Jira connector):
 *  - ConnectorCredential.externalAccountId → Clockify workspaceId
 *  - ConnectorTokens.accountId             → Clockify userId
 *  - ConnectorTokens.workspaceId           → Clockify workspaceId (redundant copy for convenience)
 *  - ConnectorTokens.accessToken           → Clockify API key
 *
 * Worklog retrieval:
 *  GET /workspaces/{workspaceId}/user/{userId}/time-entries
 *    ?start=<RFC3339>&end=<RFC3339>&page-size=200&page=N
 *  Paginate until an empty page is returned.
 *  Each entry's date is extracted from `timeInterval.start` (YYYY-MM-DD prefix).
 *  Duration is parsed from `timeInterval.duration` (ISO 8601, e.g. "PT3H30M").
 *
 * Required env vars: none (no client secret needed for API key auth)
 */

import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common'
import { ConnectorType } from '@prisma/client'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import {
  CredentialNotFoundException,
  CredentialInvalidException,
} from '../connector-credential.errors'

const CLOCKIFY_API_BASE = 'https://api.clockify.me/api/v1'

/** Map of day-of-month (1-based) → total logged seconds */
export type WorklogDayMap = Record<number, number>

export interface ClockifyWorklogsResult {
  secondsPerDay: WorklogDayMap
}

// ─── Internal API shapes ─────────────────────────────────────────────────────

interface ClockifyUser {
  id: string
  activeWorkspace: string
}

interface ClockifyTimeInterval {
  start: string // ISO 8601 e.g. "2026-05-07T09:00:00Z"
  end: string
  duration: string | null // ISO 8601 duration e.g. "PT3H30M" or null if running
}

interface ClockifyTimeEntry {
  id: string
  description?: string
  projectId?: string
  timeInterval: ClockifyTimeInterval
}

export interface ClockifyWorklogDayEntry {
  id: string
  project?: string
  description?: string
  started: string
  timeSpentSeconds: number
}

export interface ClockifyMonthlyIssueEntry {
  project?: string
  description?: string
  totalSeconds: number
  jiraIssueKey?: string
}

export interface ClockifyAddWorklogResult {
  worklogId: string
  started: string
  timeSpentSeconds: number
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ClockifyService {
  private readonly logger = new Logger(ClockifyService.name)

  constructor(private readonly credentials: ConnectorCredentialsService) {}

  private static readonly JIRA_ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/

  // ── Connect ───────────────────────────────────────────────────────────────

  /**
   * Validate the API key against Clockify, resolve the workspace, and persist
   * the credential in Key Vault / DB.
   *
   * @param userId      Houston user id
   * @param apiKey      Clockify API key supplied by the user
   * @param workspaceId Optional override; defaults to activeWorkspace from /user
   *
   * @throws UnprocessableEntityException when the API key is rejected by Clockify
   */
  async connectWithApiKey(
    userId: string,
    apiKey: string,
    workspaceId?: string,
  ): Promise<void> {
    // 1. Validate the key and resolve the Clockify userId + workspace
    const clockifyUser = await this.fetchClockifyUser(apiKey)

    const resolvedWorkspaceId = workspaceId ?? clockifyUser.activeWorkspace
    const clockifyUserId = clockifyUser.id

    // 2. Persist credential (API key as accessToken; no refresh token)
    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.CLOCKIFY,
      accessToken: apiKey,
      refreshToken: '',
      scopes: [],
      externalAccountId: resolvedWorkspaceId, // workspaceId in DB (queryable)
      accountId: clockifyUserId,              // clockify userId in KV payload
      workspaceId: resolvedWorkspaceId,       // clockify workspaceId in KV payload
    })

    this.logger.log(
      `Clockify connected: user=${userId} clockifyUser=${clockifyUserId} workspace=${resolvedWorkspaceId}`,
    )
  }

  // ── Worklogs ──────────────────────────────────────────────────────────────

  /**
   * Return per-day logged seconds for the given user and calendar month.
   *
   * @param userId  Houston user id
   * @param year    e.g. 2026
   * @param month   1-based month, e.g. 5 for May
   *
   * @throws CredentialNotFoundException  no Clockify credential
   * @throws CredentialInvalidException   API key rejected by Clockify
   */
  async getWorklogs(userId: string, year: number, month: number): Promise<ClockifyWorklogsResult> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.CLOCKIFY)

    const apiKey = tokens.accessToken
    const workspaceId = tokens.workspaceId ?? tokens.accountId // fallback: shouldn't happen
    const clockifyUserId = tokens.accountId

    if (!workspaceId || !clockifyUserId) {
      throw new CredentialInvalidException(
        'Clockify credential is missing workspaceId or userId. Please reconnect.',
      )
    }

    const start = new Date(Date.UTC(year, month - 1, 1)).toISOString()
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().replace('T00:', 'T23:').replace(/:\d{2}\.\d{3}Z$/, ':59Z')
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString()

    const entries = await this.fetchAllTimeEntries(apiKey, workspaceId, clockifyUserId, start, end)

    const secondsPerDay: WorklogDayMap = {}
    for (const entry of entries) {
      const duration = entry.timeInterval.duration
      if (!duration) continue // skip running timers

      const seconds = this.parseIsoDuration(duration)
      if (seconds <= 0) continue

      // Extract day from the start of the entry (YYYY-MM-DD, first 10 chars)
      const dateStr = entry.timeInterval.start.substring(0, 10)
      const entryDate = new Date(dateStr + 'T12:00:00Z')
      if (entryDate.getUTCFullYear() !== year || entryDate.getUTCMonth() + 1 !== month) continue

      const day = entryDate.getUTCDate()
      secondsPerDay[day] = (secondsPerDay[day] ?? 0) + seconds
    }

    return { secondsPerDay }
  }

  /**
   * Return detailed time entries for the given user and specific date.
   *
   * @param userId  Houston user id
   * @param date    ISO date string "YYYY-MM-DD"
   *
   * @throws CredentialNotFoundException  no Clockify credential
   * @throws CredentialInvalidException   API key rejected by Clockify
   */
  async getWorklogEntriesForDay(userId: string, date: string): Promise<ClockifyWorklogDayEntry[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.CLOCKIFY)

    const apiKey = tokens.accessToken
    const workspaceId = tokens.workspaceId ?? tokens.accountId
    const clockifyUserId = tokens.accountId

    if (!workspaceId || !clockifyUserId) {
      throw new CredentialInvalidException(
        'Clockify credential is missing workspaceId or userId. Please reconnect.',
      )
    }

    const start = new Date(date + 'T00:00:00Z').toISOString()
    const end = new Date(date + 'T23:59:59Z').toISOString()

    const entries = await this.fetchAllTimeEntries(apiKey, workspaceId, clockifyUserId, start, end)

    return entries
      .filter(e => e.timeInterval.duration != null)
      .map(e => ({
        id: e.id,
        project: e.projectId,
        description: e.description || undefined,
        started: e.timeInterval.start,
        timeSpentSeconds: this.parseIsoDuration(e.timeInterval.duration!),
      }))
      .filter(e => e.timeSpentSeconds > 0)
  }

  async addWorklog(
    userId: string,
    date: string,
    timeSpentSeconds: number,
    comment?: string,
    issueKey?: string,
    projectId?: string,
  ): Promise<ClockifyAddWorklogResult> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.CLOCKIFY)
    const apiKey = tokens.accessToken
    const workspaceId = tokens.workspaceId ?? tokens.accountId

    if (!workspaceId) {
      throw new CredentialInvalidException(
        'Clockify credential is missing workspaceId. Please reconnect.',
      )
    }

    const started = `${date}T12:00:00.000Z`
    const ended = new Date(new Date(started).getTime() + timeSpentSeconds * 1000).toISOString()

    const trimmedIssue = issueKey?.trim().toUpperCase()
    const trimmedComment = comment?.trim()
    const description = trimmedIssue
      ? (trimmedComment ? `${trimmedIssue} ${trimmedComment}` : trimmedIssue)
      : (trimmedComment || 'Worklog')

    const url = `${CLOCKIFY_API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/time-entries`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        start: started,
        end: ended,
        description,
        billable: true,
        ...(projectId ? { projectId } : {}),
      }),
    })

    if (response.status === 401) {
      throw new CredentialInvalidException(
        'Clockify API key is no longer valid. Please reconnect.',
      )
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = `Clockify addWorklog failed with status ${response.status}.`

      if (text) {
        try {
          const parsed = JSON.parse(text) as { message?: string }
          message = parsed.message?.trim() || message
        } catch {
          message = text.trim() || message
        }
      }

      throw new BadRequestException(message)
    }

    const data = (await response.json()) as { id?: string; timeInterval?: { start?: string } }
    if (!data?.id) {
      throw new Error('Clockify addWorklog returned invalid payload.')
    }

    return {
      worklogId: data.id,
      started: data.timeInterval?.start ?? started,
      timeSpentSeconds,
    }
  }

  /**
   * Return month totals grouped by Clockify project + description.
   */
  async getWorklogIssuesForMonth(
    userId: string,
    year: number,
    month: number,
  ): Promise<ClockifyMonthlyIssueEntry[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.CLOCKIFY)

    const apiKey = tokens.accessToken
    const workspaceId = tokens.workspaceId ?? tokens.accountId
    const clockifyUserId = tokens.accountId

    if (!workspaceId || !clockifyUserId) {
      throw new CredentialInvalidException(
        'Clockify credential is missing workspaceId or userId. Please reconnect.',
      )
    }

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString()
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString()
    const entries = await this.fetchAllTimeEntries(apiKey, workspaceId, clockifyUserId, start, end)

    const totals = new Map<string, ClockifyMonthlyIssueEntry>()

    for (const entry of entries) {
      const duration = entry.timeInterval.duration
      if (!duration) continue

      const seconds = this.parseIsoDuration(duration)
      if (seconds <= 0) continue

      const dateStr = entry.timeInterval.start.substring(0, 10)
      const entryDate = new Date(dateStr + 'T12:00:00Z')
      if (entryDate.getUTCFullYear() !== year || entryDate.getUTCMonth() + 1 !== month) continue

      const project = entry.projectId || undefined
      const description = entry.description?.trim() || undefined
      const key = `${project ?? ''}|${description ?? ''}`
      const jiraIssueKey = this.extractJiraIssueKey(`${project ?? ''} ${description ?? ''}`)

      const existing = totals.get(key)
      if (existing) {
        existing.totalSeconds += seconds
      } else {
        totals.set(key, {
          project,
          description,
          totalSeconds: seconds,
          jiraIssueKey,
        })
      }
    }

    return Array.from(totals.values()).sort((a, b) => b.totalSeconds - a.totalSeconds)
  }

  /** Return detailed time entries for one Clockify project in a selected month. */
  async getWorklogEntriesForIssueInMonth(
    userId: string,
    year: number,
    month: number,
    reference: string,
  ): Promise<ClockifyWorklogDayEntry[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.CLOCKIFY)
    const workspaceId = tokens.workspaceId ?? tokens.accountId
    const clockifyUserId = tokens.accountId

    if (!workspaceId || !clockifyUserId) {
      throw new CredentialInvalidException(
        'Clockify credential is missing workspaceId or userId. Please reconnect.',
      )
    }

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString()
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString()
    const entries = await this.fetchAllTimeEntries(
      tokens.accessToken,
      workspaceId,
      clockifyUserId,
      start,
      end,
    )

    return entries
      .filter((entry) => (entry.projectId || 'Clockify') === reference)
      .map((entry) => ({
        id: entry.id,
        project: entry.projectId || undefined,
        description: entry.description?.trim() || undefined,
        started: entry.timeInterval.start,
        timeSpentSeconds: entry.timeInterval.duration
          ? this.parseIsoDuration(entry.timeInterval.duration)
          : 0,
      }))
      .filter((entry) => entry.timeSpentSeconds > 0)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async fetchClockifyUser(apiKey: string): Promise<ClockifyUser> {
    const response = await fetch(`${CLOCKIFY_API_BASE}/user`, {
      headers: { 'X-Api-Key': apiKey },
    })

    if (response.status === 401) {
      throw new UnprocessableEntityException(
        'Invalid Clockify API key. Please check and try again.',
      )
    }

    if (!response.ok) {
      throw new UnprocessableEntityException(
        `Clockify API returned ${response.status}. Please try again.`,
      )
    }

    const data: unknown = await response.json()
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).id !== 'string' ||
      typeof (data as Record<string, unknown>).activeWorkspace !== 'string'
    ) {
      throw new UnprocessableEntityException('Unexpected response from Clockify API.')
    }

    return data as ClockifyUser
  }

  private async fetchAllTimeEntries(
    apiKey: string,
    workspaceId: string,
    clockifyUserId: string,
    start: string,
    end: string,
  ): Promise<ClockifyTimeEntry[]> {
    const results: ClockifyTimeEntry[] = []
    let page = 1
    const pageSize = 200

    while (true) {
      const params = new URLSearchParams({
        start,
        end,
        'page-size': String(pageSize),
        page: String(page),
      })

      const url = `${CLOCKIFY_API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/user/${encodeURIComponent(clockifyUserId)}/time-entries?${params.toString()}`

      const response = await fetch(url, {
        headers: { 'X-Api-Key': apiKey },
      })

      if (response.status === 401) {
        throw new CredentialInvalidException(
          'Clockify API key is no longer valid. Please reconnect.',
        )
      }

      if (!response.ok) {
        this.logger.warn(`Clockify time-entries API returned ${response.status} on page ${page}`)
        break
      }

      const data: unknown = await response.json()
      if (!Array.isArray(data)) break

      const page_entries = data as ClockifyTimeEntry[]
      results.push(...page_entries)

      // Clockify returns an empty array when there are no more pages
      if (page_entries.length < pageSize) break
      page++
    }

    return results
  }

  /**
   * Parse ISO 8601 duration string to total seconds.
   * Handles: PT1H30M, PT45M, PT3600S, PT1H, P1DT2H (days supported)
   */
  private parseIsoDuration(duration: string): number {
    // Pattern: P[nD]T[nH][nM][nS]
    const match = duration.match(
      /^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
    )
    if (!match) return 0

    const days = parseFloat(match[1] ?? '0')
    const hours = parseFloat(match[2] ?? '0')
    const minutes = parseFloat(match[3] ?? '0')
    const seconds = parseFloat(match[4] ?? '0')

    return Math.round(days * 86400 + hours * 3600 + minutes * 60 + seconds)
  }

  private extractJiraIssueKey(text: string): string | undefined {
    const match = text.toUpperCase().match(ClockifyService.JIRA_ISSUE_KEY_RE)
    return match?.[1]
  }
}
