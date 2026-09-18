/**
 * JiraService
 *
 * Fetches worklog data from Jira Cloud for a connected user.
 *
 * Methodology:
 *  1. JQL search – GET /search/jql?jql=worklogAuthor=<id> AND worklogDate>=<start> AND worklogDate<=<end>
 *     Returns only issues the current user has logged work on in the requested month.
 *     Paginated (100 issues per page).
 *  2. GET /issue/<key>/worklog?startedAfter=<ms>&startedBefore=<ms>
 *     Fetches full worklog entries per issue, filtered to the month.
 *     Issued in parallel across all matching issues.
 *  3. Filter entries by author.accountId (server-side filter already applied by JQL;
 *     kept as a safety guard). Extract date from "started" substring to avoid UTC shift.
 *  4. Aggregate timeSpentSeconds per calendar day.
 *
 * Token refresh:
 *  - Proactive refresh if token is within 5 minutes of expiry.
 *  - Reactive refresh on 401 response.
 *  - 403 / invalid → marks credential INVALID in DB.
 *
 * Required OAuth scopes: read:jira-work, write:jira-work, read:jira-user, offline_access
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { ConnectorType } from '@prisma/client'
import {
  CredentialNotFoundException,
  CredentialExpiredException,
  CredentialInvalidException,
} from '../connector-credential.errors'

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira'

/** Map of day-of-month (1-based) → total logged seconds */
export type WorklogDayMap = Record<number, number>

export interface JiraIssueDetails {
  key: string
  summary: string
  priority: 'low' | 'medium' | 'high' | 'critical' | null
  status: 'todo' | 'in-progress' | 'done' | 'blocked'
  assignee: { displayName: string; email: string } | null
  reporter: { displayName: string; email: string } | null
  duedate: string | null
  labels: string[]
  projectKey: string
  updatedAt: string | null
}

function normalizeJiraPriority(p: string | undefined): JiraIssueDetails['priority'] {
  switch (p?.toLowerCase()) {
    case 'highest': case 'critical': return 'critical'
    case 'high': return 'high'
    case 'medium': case 'normal': return 'medium'
    case 'low': case 'lowest': case 'minor': return 'low'
    default: return null
  }
}

function normalizeJiraStatus(s: string | undefined): JiraIssueDetails['status'] {
  const lower = s?.toLowerCase() ?? ''
  if (lower.includes('done') || lower.includes('closed') || lower.includes('resolved')) return 'done'
  if (lower.includes('progress') || lower.includes('review') || lower.includes('testing')) return 'in-progress'
  if (lower.includes('block')) return 'blocked'
  return 'todo'
}

export interface JiraWorklogsResult {
  /** Day-of-month → total seconds logged. Days with no worklogs are absent. */
  secondsPerDay: WorklogDayMap
  /** Atlassian accountId used to filter entries. */
  accountId: string
  /** Jira Cloud site id. */
  cloudId: string
}

export interface JiraWorklogStats {
  count: number
  seconds: number
}

// ─── Internal API shapes ─────────────────────────────────────────────────────

interface JiraWorklogEntry {
  author: { accountId: string }
  timeSpentSeconds: number
  started: string // ISO 8601, e.g. "2026-05-07T09:00:00.000+0000"
}

/** Full worklog entry from JQL search expansion – includes id, issueId, comment */
interface JiraWorklogEntryFull {
  id: string
  author: { accountId: string }
  timeSpentSeconds: number
  started: string
  comment?: unknown // ADF document or plain string
}

/** Structured daily worklog entry returned to callers */
export interface JiraWorklogDayEntry {
  id: string
  issueId: string // Human-readable issue key, e.g. "PROJ-42"
  issueName?: string // Jira issue summary (title)
  started: string
  timeSpentSeconds: number
  comment?: string
}

export interface JiraMonthlyIssueEntry {
  issueId: string
  issueName?: string
  totalSeconds: number
}

/** Extract plain text from an Atlassian Document Format (ADF) comment or plain string */
function extractAdfText(comment: unknown): string | undefined {
  if (!comment) return undefined
  if (typeof comment === 'string') return comment || undefined
  if (typeof comment === 'object') {
    const parts: string[] = []
    const traverse = (nodes: unknown[]): void => {
      for (const node of nodes) {
        const n = node as Record<string, unknown>
        if (n['type'] === 'text' && typeof n['text'] === 'string') parts.push(n['text'])
        if (Array.isArray(n['content'])) traverse(n['content'] as unknown[])
      }
    }
    const root = comment as Record<string, unknown>
    if (Array.isArray(root['content'])) traverse(root['content'] as unknown[])
    return parts.join('') || undefined
  }
  return undefined
}



@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name)
  private readonly refreshInFlight = new Map<string, Promise<string>>()

  constructor(
    private readonly credentials: ConnectorCredentialsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Return per-day logged seconds for the given user/month.
   *
   * @param userId  Houston user id
   * @param year    e.g. 2026
   * @param month   1-based month, e.g. 5 for May
   *
   * @throws CredentialNotFoundException  no Jira credential
   * @throws CredentialExpiredException   token expired, re-auth required
   * @throws CredentialInvalidException   token revoked/invalidated
   */
  async getWorklogs(userId: string, year: number, month: number): Promise<JiraWorklogsResult> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    const accountId = tokens.accountId
    if (!accountId) {
      throw new CredentialInvalidException(
        'Jira credential is missing accountId. Please reconnect your Jira account.',
      )
    }

    const secondsPerDay = await this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.fetchWorklogs(token, cloudId, accountId, year, month),
    )
    return { secondsPerDay, accountId, cloudId }
  }

  async getAllWorklogStats(userId: string): Promise<JiraWorklogStats> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    const accountId = tokens.accountId
    if (!accountId) {
      throw new CredentialInvalidException(
        'Jira credential is missing accountId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.fetchAllWorklogStats(token, cloudId, accountId),
    )
  }

  /**
   * Return detailed worklog entries for the given user and specific date.
   *
   * Uses a single JQL search request to fetch all issues with worklogs by the user
   * on that date. Issue keys are returned directly (not internal numeric IDs).
   *
   * @param userId  Houston user id
   * @param date    ISO date string "YYYY-MM-DD"
   */
  async getWorklogEntriesForDay(userId: string, date: string): Promise<JiraWorklogDayEntry[]> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    const accountId = tokens.accountId
    if (!accountId) {
      throw new CredentialInvalidException(
        'Jira credential is missing accountId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.fetchWorklogEntriesForDay(token, cloudId, accountId, date),
    )
  }

  /**
   * Return monthly totals grouped by Jira issue key.
   */
  async getWorklogIssuesForMonth(
    userId: string,
    year: number,
    month: number,
  ): Promise<JiraMonthlyIssueEntry[]> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    const accountId = tokens.accountId
    if (!accountId) {
      throw new CredentialInvalidException(
        'Jira credential is missing accountId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.fetchMonthlyIssueTotals(token, cloudId, accountId, year, month),
    )
  }

  /**
   * Return detailed worklog entries for one Jira issue in a selected month.
   */
  async getWorklogEntriesForIssueInMonth(
    userId: string,
    year: number,
    month: number,
    issueId: string,
  ): Promise<JiraWorklogDayEntry[]> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    const accountId = tokens.accountId
    if (!accountId) {
      throw new CredentialInvalidException(
        'Jira credential is missing accountId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.fetchIssueWorklogsForMonth(token, cloudId, accountId, year, month, issueId),
    )
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchWorklogs(
    accessToken: string,
    cloudId: string,
    accountId: string,
    year: number,
    month: number,
  ): Promise<WorklogDayMap> {
    const apiBase = `${JIRA_API_BASE}/${cloudId}/rest/api/3`
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    const result: WorklogDayMap = {}

    // Build date range strings for the requested month.
    const mm = String(month).padStart(2, '0')
    const lastDay = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${mm}-01`
    const monthEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`

    // Step 1: JQL search – find only the issues this user logged work on in this month.
    // worklogDate filters by the worklog's "started" date, so no buffer is needed.
    const jql = `worklogAuthor = "${accountId}" AND worklogDate >= "${monthStart}" AND worklogDate <= "${monthEnd}"`
    const issueKeys: string[] = []
    let searchStartAt = 0

    while (true) {
      const searchUrl = new URL(`${apiBase}/search/jql`)
      searchUrl.searchParams.set('jql', jql)
      searchUrl.searchParams.set('fields', 'key')
      searchUrl.searchParams.set('maxResults', '100')
      searchUrl.searchParams.set('startAt', String(searchStartAt))

      const searchRes = await fetch(searchUrl.toString(), { headers })

      if (searchRes.status === 401 || searchRes.status === 403) {
        throw new JiraUnauthorizedError(`Jira search returned ${searchRes.status}`)
      }
      if (!searchRes.ok) {
        const text = await searchRes.text()
        throw new Error(`Jira search error ${searchRes.status}: ${text}`)
      }

      const searchData = (await searchRes.json()) as {
        issues?: Array<{ key: string }>
        total?: number
      }
      const issues = searchData.issues ?? []
      for (const issue of issues) {
        issueKeys.push(issue.key)
      }

      if (searchStartAt + issues.length >= (searchData.total ?? 0)) break
      searchStartAt += issues.length
    }

    this.logger.debug(
      `Jira: found ${issueKeys.length} issues with worklogs for ${year}-${mm} (accountId=${accountId})`,
    )

    if (issueKeys.length === 0) return result

    // Step 2: For each issue fetch worklogs for the month using epoch-ms range filters.
    const monthStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0)
    const monthEndMs = Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999)

    const fetchIssueWorklogs = async (issueKey: string): Promise<void> => {
      let startAt = 0
      const maxResults = 100

      while (true) {
        const wlUrl = new URL(`${apiBase}/issue/${encodeURIComponent(issueKey)}/worklog`)
        wlUrl.searchParams.set('startedAfter', String(monthStartMs))
        wlUrl.searchParams.set('startedBefore', String(monthEndMs))
        wlUrl.searchParams.set('startAt', String(startAt))
        wlUrl.searchParams.set('maxResults', String(maxResults))

        const wlRes = await fetch(wlUrl.toString(), { headers })
        if (wlRes.status === 401 || wlRes.status === 403) {
          throw new JiraUnauthorizedError(`Jira worklog fetch returned ${wlRes.status}`)
        }
        if (!wlRes.ok) break

        const wlData = (await wlRes.json()) as {
          total: number
          worklogs: JiraWorklogEntry[]
        }

        for (const entry of wlData.worklogs) {
          if (entry.author.accountId !== accountId) continue

          // Extract date from the started string directly to avoid UTC offset shifting the day.
          // e.g. "2026-05-08T09:00:00.000+0200" → "2026-05-08"
          const datePart = entry.started.substring(0, 10)
          const [entryYear, entryMonth, entryDay] = datePart.split('-').map(Number)

          if (entryYear !== year || entryMonth !== month) continue

          result[entryDay] = (result[entryDay] ?? 0) + entry.timeSpentSeconds
        }

        if (startAt + wlData.worklogs.length >= wlData.total) break
        startAt += wlData.worklogs.length
      }
    }

    await Promise.all(issueKeys.map(fetchIssueWorklogs))

    return result
  }

  private async fetchAllWorklogStats(
    accessToken: string,
    cloudId: string,
    accountId: string,
  ): Promise<JiraWorklogStats> {
    const apiBase = `${JIRA_API_BASE}/${cloudId}/rest/api/3`
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    const issueKeys: string[] = []
    let searchStartAt = 0

    while (true) {
      const searchUrl = new URL(`${apiBase}/search/jql`)
      searchUrl.searchParams.set('jql', `worklogAuthor = "${accountId}"`)
      searchUrl.searchParams.set('fields', 'key')
      searchUrl.searchParams.set('maxResults', '100')
      searchUrl.searchParams.set('startAt', String(searchStartAt))

      const searchRes = await fetch(searchUrl.toString(), { headers })
      if (searchRes.status === 401 || searchRes.status === 403) {
        throw new JiraUnauthorizedError(`Jira search returned ${searchRes.status}`)
      }
      if (!searchRes.ok) {
        const text = await searchRes.text()
        throw new Error(`Jira search error ${searchRes.status}: ${text}`)
      }

      const searchData = (await searchRes.json()) as { issues?: Array<{ key: string }>; total?: number }
      const issues = searchData.issues ?? []
      issueKeys.push(...issues.map((issue) => issue.key))
      if (searchStartAt + issues.length >= (searchData.total ?? 0)) break
      searchStartAt += issues.length
    }

    const stats: JiraWorklogStats = { count: 0, seconds: 0 }
    for (const issueKey of issueKeys) {
      let startAt = 0
      while (true) {
        const worklogsUrl = new URL(`${apiBase}/issue/${encodeURIComponent(issueKey)}/worklog`)
        worklogsUrl.searchParams.set('startAt', String(startAt))
        worklogsUrl.searchParams.set('maxResults', '100')

        const worklogsRes = await fetch(worklogsUrl.toString(), { headers })
        if (worklogsRes.status === 401 || worklogsRes.status === 403) {
          throw new JiraUnauthorizedError(`Jira worklog fetch returned ${worklogsRes.status}`)
        }
        if (!worklogsRes.ok) {
          const text = await worklogsRes.text()
          throw new Error(`Jira worklog fetch error ${worklogsRes.status}: ${text}`)
        }

        const worklogsData = (await worklogsRes.json()) as { total: number; worklogs: JiraWorklogEntry[] }
        for (const worklog of worklogsData.worklogs) {
          if (worklog.author.accountId !== accountId) continue
          stats.count += 1
          stats.seconds += worklog.timeSpentSeconds
        }

        if (startAt + worklogsData.worklogs.length >= worklogsData.total) break
        startAt += worklogsData.worklogs.length
      }
    }

    return stats
  }

  /**
   * Fetch detailed worklog entries for a specific date using a single JQL search.
   * JQL: worklogDate = "YYYY-MM-DD" AND worklogAuthor = "<accountId>"
   * Returns issue keys (human-readable) not internal numeric IDs.
   */
  private async fetchWorklogEntriesForDay(
    accessToken: string,
    cloudId: string,
    accountId: string,
    date: string,
  ): Promise<JiraWorklogDayEntry[]> {
    const apiBase = `${JIRA_API_BASE}/${cloudId}/rest/api/3`
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

    // Step 1: JQL search – only to get issue keys, no worklog expansion needed.
    // The embedded worklog field is limited to 20 entries per issue, so we
    // must NOT rely on it for completeness.
    const jql = `worklogDate = "${date}" AND worklogAuthor = "${accountId}"`
    const searchUrl = new URL(`${apiBase}/search/jql`)
    searchUrl.searchParams.set('jql', jql)
    searchUrl.searchParams.set('fields', 'key,summary')
    searchUrl.searchParams.set('maxResults', '50')

    const searchRes = await fetch(searchUrl.toString(), { headers })

    if (searchRes.status === 401 || searchRes.status === 403) {
      throw new JiraUnauthorizedError(`Jira search returned ${searchRes.status}`)
    }
    if (!searchRes.ok) {
      const text = await searchRes.text()
      throw new Error(`Jira search error ${searchRes.status}: ${text}`)
    }

    const searchData = (await searchRes.json()) as { issues?: Array<{ key: string; fields: { summary?: string } }> }
    const issueKeys = (searchData.issues ?? []).map(i => i.key)
    const issueSummaries = Object.fromEntries(
      (searchData.issues ?? []).map(i => [i.key, i.fields?.summary]),
    )

    if (issueKeys.length === 0) return []

    // Step 2: For each issue fetch only worklogs within the specific day using
    // startedAfter / startedBefore epoch-ms filters – avoids fetching all historical
    // worklogs and makes pagination rare (single day = almost always 1 page).
    const dayStartMs = new Date(date + 'T00:00:00.000Z').getTime()
    const dayEndMs = new Date(date + 'T23:59:59.999Z').getTime()

    const fetchIssueWorklogs = async (issueKey: string): Promise<JiraWorklogDayEntry[]> => {
      const result: JiraWorklogDayEntry[] = []
      let startAt = 0
      const maxResults = 100

      while (true) {
        const wlUrl = new URL(`${apiBase}/issue/${encodeURIComponent(issueKey)}/worklog`)
        wlUrl.searchParams.set('startedAfter', String(dayStartMs))
        wlUrl.searchParams.set('startedBefore', String(dayEndMs))
        wlUrl.searchParams.set('startAt', String(startAt))
        wlUrl.searchParams.set('maxResults', String(maxResults))

        const wlRes = await fetch(wlUrl.toString(), { headers })
        if (!wlRes.ok) break

        const wlData = (await wlRes.json()) as {
          total: number
          worklogs: JiraWorklogEntryFull[]
        }

        for (const wl of wlData.worklogs) {
          if (wl.author?.accountId !== accountId) continue
          result.push({
            id: String(wl.id),
            issueId: issueKey,
            issueName: issueSummaries[issueKey],
            started: wl.started,
            timeSpentSeconds: wl.timeSpentSeconds,
            comment: extractAdfText(wl.comment),
          })
        }

        if (startAt + wlData.worklogs.length >= wlData.total) break
        startAt += wlData.worklogs.length
      }

      return result
    }

    const perIssueResults = await Promise.all(issueKeys.map(fetchIssueWorklogs))
    const entries = perIssueResults.flat()

    this.logger.debug(`Jira day detail: ${entries.length} entries for ${date} across ${issueKeys.length} issues`)
    return entries
  }

  private async fetchMonthlyIssueTotals(
    accessToken: string,
    cloudId: string,
    accountId: string,
    year: number,
    month: number,
  ): Promise<JiraMonthlyIssueEntry[]> {
    const apiBase = `${JIRA_API_BASE}/${cloudId}/rest/api/3`
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

    const mm = String(month).padStart(2, '0')
    const lastDay = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${mm}-01`
    const monthEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
    const monthStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0)
    const monthEndMs = Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999)

    const jql = `worklogAuthor = "${accountId}" AND worklogDate >= "${monthStart}" AND worklogDate <= "${monthEnd}"`

    const issueInfos: Array<{ key: string; summary?: string }> = []
    let searchStartAt = 0

    while (true) {
      const searchUrl = new URL(`${apiBase}/search/jql`)
      searchUrl.searchParams.set('jql', jql)
      searchUrl.searchParams.set('fields', 'key,summary')
      searchUrl.searchParams.set('maxResults', '100')
      searchUrl.searchParams.set('startAt', String(searchStartAt))

      const searchRes = await fetch(searchUrl.toString(), { headers })
      if (searchRes.status === 401 || searchRes.status === 403) {
        throw new JiraUnauthorizedError(`Jira search returned ${searchRes.status}`)
      }
      if (!searchRes.ok) {
        const text = await searchRes.text()
        throw new Error(`Jira search error ${searchRes.status}: ${text}`)
      }

      const searchData = (await searchRes.json()) as {
        issues?: Array<{ key: string; fields?: { summary?: string } }>
        total?: number
      }
      const issues = searchData.issues ?? []
      for (const issue of issues) {
        issueInfos.push({ key: issue.key, summary: issue.fields?.summary })
      }

      if (searchStartAt + issues.length >= (searchData.total ?? 0)) break
      searchStartAt += issues.length
    }

    if (issueInfos.length === 0) return []

    const totals = new Map<string, { issueName?: string; totalSeconds: number }>()

    const fetchIssueWorklogs = async (issueInfo: { key: string; summary?: string }): Promise<void> => {
      let startAt = 0
      const maxResults = 100

      while (true) {
        const wlUrl = new URL(`${apiBase}/issue/${encodeURIComponent(issueInfo.key)}/worklog`)
        wlUrl.searchParams.set('startedAfter', String(monthStartMs))
        wlUrl.searchParams.set('startedBefore', String(monthEndMs))
        wlUrl.searchParams.set('startAt', String(startAt))
        wlUrl.searchParams.set('maxResults', String(maxResults))

        const wlRes = await fetch(wlUrl.toString(), { headers })
        if (wlRes.status === 401 || wlRes.status === 403) {
          throw new JiraUnauthorizedError(`Jira worklog fetch returned ${wlRes.status}`)
        }
        if (!wlRes.ok) break

        const wlData = (await wlRes.json()) as {
          total: number
          worklogs: JiraWorklogEntry[]
        }

        for (const entry of wlData.worklogs) {
          if (entry.author.accountId !== accountId) continue

          const datePart = entry.started.substring(0, 10)
          const [entryYear, entryMonth] = datePart.split('-').map(Number)
          if (entryYear !== year || entryMonth !== month) continue

          const existing = totals.get(issueInfo.key)
          if (existing) {
            existing.totalSeconds += entry.timeSpentSeconds
          } else {
            totals.set(issueInfo.key, {
              issueName: issueInfo.summary,
              totalSeconds: entry.timeSpentSeconds,
            })
          }
        }

        if (startAt + wlData.worklogs.length >= wlData.total) break
        startAt += wlData.worklogs.length
      }
    }

    await Promise.all(issueInfos.map(fetchIssueWorklogs))

    return Array.from(totals.entries())
      .map(([issueId, value]) => ({ issueId, issueName: value.issueName, totalSeconds: value.totalSeconds }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
  }

  private async fetchIssueWorklogsForMonth(
    accessToken: string,
    cloudId: string,
    accountId: string,
    year: number,
    month: number,
    issueId: string,
  ): Promise<JiraWorklogDayEntry[]> {
    const apiBase = `${JIRA_API_BASE}/${cloudId}/rest/api/3`
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

    const mm = String(month).padStart(2, '0')
    const lastDay = new Date(year, month, 0).getDate()
    const monthStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0)
    const monthEndMs = Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999)

    let startAt = 0
    const maxResults = 100
    const entries: JiraWorklogDayEntry[] = []

    while (true) {
      const wlUrl = new URL(`${apiBase}/issue/${encodeURIComponent(issueId)}/worklog`)
      wlUrl.searchParams.set('startedAfter', String(monthStartMs))
      wlUrl.searchParams.set('startedBefore', String(monthEndMs))
      wlUrl.searchParams.set('startAt', String(startAt))
      wlUrl.searchParams.set('maxResults', String(maxResults))

      const wlRes = await fetch(wlUrl.toString(), { headers })
      if (wlRes.status === 401 || wlRes.status === 403) {
        throw new JiraUnauthorizedError(`Jira worklog fetch returned ${wlRes.status}`)
      }
      if (!wlRes.ok) {
        const text = await wlRes.text()
        throw new Error(`Jira worklog fetch error ${wlRes.status}: ${text}`)
      }

      const wlData = (await wlRes.json()) as {
        total: number
        worklogs: JiraWorklogEntryFull[]
      }

      for (const wl of wlData.worklogs) {
        if (wl.author?.accountId !== accountId) continue

        const datePart = wl.started.substring(0, 10)
        const [entryYear, entryMonth] = datePart.split('-').map(Number)
        if (entryYear !== year || entryMonth !== month) continue

        entries.push({
          id: String(wl.id),
          issueId,
          started: wl.started,
          timeSpentSeconds: wl.timeSpentSeconds,
          comment: extractAdfText(wl.comment),
        })
      }

      if (startAt + wlData.worklogs.length >= wlData.total) break
      startAt += wlData.worklogs.length
    }

    this.logger.debug(`Jira issue detail: ${entries.length} entries for ${issueId} in ${year}-${mm}`)
    return entries.sort((a, b) => a.started.localeCompare(b.started))
  }

  /**
   * Return normalized issue details for a single Jira issue key.
   * Returns null if the issue is not found, credentials are missing, or any error occurs.
   */
  async getIssueDetails(userId: string, issueKey: string): Promise<JiraIssueDetails | null> {
    try {
      const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
      const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)
      const cloudId = meta.externalAccountId
      if (!cloudId) return null
      return await this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
        this.fetchIssueDetails(token, cloudId, issueKey),
      )
    } catch {
      return null
    }
  }

  private async fetchIssueDetails(
    accessToken: string,
    cloudId: string,
    issueKey: string,
  ): Promise<JiraIssueDetails | null> {
    const url = new URL(`${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}`)
    url.searchParams.set('fields', 'summary,status,priority,assignee,reporter,duedate,labels,project,updated')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (res.status === 401 || res.status === 403) {
      throw new JiraUnauthorizedError(`Jira getIssueDetails returned ${res.status}`)
    }
    if (!res.ok) return null

    const data = (await res.json()) as {
      key: string
      fields: {
        summary?: string
        status?: { name?: string }
        priority?: { name?: string }
        assignee?: { displayName?: string; emailAddress?: string } | null
        reporter?: { displayName?: string; emailAddress?: string } | null
        duedate?: string | null
        labels?: string[]
        project?: { key?: string }
        updated?: string | null
      }
    }
    const f = data.fields
    return {
      key: data.key,
      summary: f.summary ?? issueKey,
      status: normalizeJiraStatus(f.status?.name),
      priority: normalizeJiraPriority(f.priority?.name),
      assignee: f.assignee?.emailAddress
        ? { displayName: f.assignee.displayName ?? f.assignee.emailAddress, email: f.assignee.emailAddress }
        : null,
      reporter: f.reporter?.emailAddress
        ? { displayName: f.reporter.displayName ?? f.reporter.emailAddress, email: f.reporter.emailAddress }
        : null,
      duedate: f.duedate ?? null,
      labels: f.labels ?? [],
      projectKey: f.project?.key ?? issueKey.split('-')[0],
      updatedAt: f.updated ?? null,
    }
  }

  /**
   * Exchange refresh token for a new access token and persist it.
   * On failure, marks the credential INVALID.
   */
  async refreshAccessToken(
    userId: string,
    refreshToken: string,
    expectedAccessToken?: string,
  ): Promise<string> {
    const inFlightRefresh = this.refreshInFlight.get(userId)
    if (inFlightRefresh) {
      return inFlightRefresh
    }

    const refreshPromise = this.performRefreshAccessToken(
      userId,
      refreshToken,
      expectedAccessToken,
    )
    this.refreshInFlight.set(userId, refreshPromise)

    try {
      return await refreshPromise
    } finally {
      if (this.refreshInFlight.get(userId) === refreshPromise) {
        this.refreshInFlight.delete(userId)
      }
    }
  }

  private async performRefreshAccessToken(
    userId: string,
    refreshToken: string,
    expectedAccessToken?: string,
  ): Promise<string> {
    let existingTokens:
      | Awaited<ReturnType<ConnectorCredentialsService['getTokens']>>
      | null = null

    if (expectedAccessToken) {
      existingTokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)
      if (existingTokens.accessToken !== expectedAccessToken) {
        return existingTokens.accessToken
      }
      refreshToken = existingTokens.refreshToken
    }

    const clientId = this.config.get<string>('JIRA_CLIENT_ID')
    const clientSecret = this.config.get<string>('JIRA_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      await this.credentials.markInvalid(userId, ConnectorType.JIRA)
      throw new Error('JIRA_CLIENT_ID / JIRA_CLIENT_SECRET not configured')
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })

    const res = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      // Only permanently invalidate for 4xx — Atlassian rejected the grant (revoked, expired refresh token).
      // 5xx or network errors are transient; keep the credential so the next request can retry.
      if (res.status >= 400 && res.status < 500) {
        await this.credentials.markInvalid(userId, ConnectorType.JIRA)
      }
      throw new Error(`Jira token refresh failed (${res.status}): ${text}`)
    }

    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    if (!data.access_token) {
      await this.credentials.markInvalid(userId, ConnectorType.JIRA)
      throw new Error('Jira token refresh response missing access_token')
    }

    // Carry the identifiers resolved during the initial OAuth callback across the
    // refresh: cloudId (DB externalAccountId) and the Atlassian accountId (Key Vault
    // payload). Losing either makes every later Jira call fail with
    // "missing cloudId/accountId – please reconnect", even though the tokens are fine.
    existingTokens ??= await this.credentials.getTokens(userId, ConnectorType.JIRA).catch(() => null)
    const existingMeta = await this.credentials
      .getMetadata(userId, ConnectorType.JIRA)
      .catch(() => null)

    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.JIRA,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
      externalAccountId: existingMeta?.externalAccountId ?? undefined,
      expiresAt:
        typeof data.expires_in === 'number'
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : undefined,
      accountId: existingTokens?.accountId,
    })

    this.logger.log(`Jira access token refreshed for user=${userId}`)
    return data.access_token
  }

  /**
   * Executes `op(accessToken)` with automatic proactive and reactive token refresh.
   * On double-401, marks the credential INVALID and rethrows.
   */
  private async withJiraAuth<T>(
    userId: string,
    tokens: { accessToken: string; refreshToken: string },
    tokenExpiresAt: Date | null,
    op: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    let accessToken = tokens.accessToken
    if (this.isNearExpiry(tokenExpiresAt)) {
      this.logger.debug(`Jira token near expiry for user=${userId} – refreshing proactively`)
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken, accessToken)
    }

    try {
      return await op(accessToken)
    } catch (err: unknown) {
      if (!isHttpUnauthorized(err)) throw err

      this.logger.warn(`Jira 401 for user=${userId} – refreshing token`)
      // Refresh failure already handles markInvalid() for permanent errors.
      // Don't wrap the retry in the same catch — a Jira API error after a
      // successful refresh must not invalidate a perfectly valid credential.
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken, accessToken)
      return await op(accessToken)
    }
  }

  private isNearExpiry(tokenExpiresAt: Date | null): boolean {
    if (!tokenExpiresAt) return false
    const fiveMinutes = 5 * 60 * 1000
    return tokenExpiresAt.getTime() - Date.now() < fiveMinutes
  }

  /**
   * Add a worklog entry to a Jira issue on behalf of the user.
   *
   * @param userId           Houston user id
   * @param issueKey         e.g. "PROJ-123"
   * @param date             ISO date "YYYY-MM-DD"
   * @param timeSpentSeconds Must be ≥ 60
   * @param comment          Optional plain-text comment
   *
   * @returns { worklogId, started, timeSpentSeconds }
   */
  async addWorklog(
    userId: string,
    issueKey: string,
    date: string,
    timeSpentSeconds: number,
    comment?: string,
  ): Promise<{ worklogId: string; started: string; timeSpentSeconds: number }> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.postWorklog(token, cloudId, issueKey, date, timeSpentSeconds, comment),
    )
  }

  private async postWorklog(
    accessToken: string,
    cloudId: string,
    issueKey: string,
    date: string,
    timeSpentSeconds: number,
    comment?: string,
  ): Promise<{ worklogId: string; started: string; timeSpentSeconds: number }> {
    // Use noon UTC to ensure the date never shifts regardless of the user's timezone
    const started = `${date}T12:00:00.000+0000`

    const body: Record<string, unknown> = {
      started,
      timeSpentSeconds,
    }

    // Jira REST API v3 requires comment in Atlassian Document Format (ADF)
    if (comment && comment.trim().length > 0) {
      body['comment'] = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: comment.trim() }],
          },
        ],
      }
    }

    const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${issueKey}/worklog`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.status === 401 || res.status === 403) {
      throw new JiraUnauthorizedError(`Jira addWorklog returned ${res.status}`)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Jira addWorklog error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as { id: string; started: string; timeSpentSeconds: number }
    this.logger.log(
      `Jira worklog created: id=${data.id} issue=${issueKey} date=${date} seconds=${timeSpentSeconds}`,
    )
    return { worklogId: data.id, started: data.started, timeSpentSeconds: data.timeSpentSeconds }
  }

  async updateWorklog(
    userId: string,
    worklogId: string,
    issueKey: string,
    date: string,
    timeSpentSeconds: number,
    comment?: string,
  ): Promise<{ worklogId: string; started: string; timeSpentSeconds: number }> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.putWorklog(token, cloudId, worklogId, issueKey, date, timeSpentSeconds, comment),
    )
  }

  private async putWorklog(
    accessToken: string,
    cloudId: string,
    worklogId: string,
    issueKey: string,
    date: string,
    timeSpentSeconds: number,
    comment?: string,
  ): Promise<{ worklogId: string; started: string; timeSpentSeconds: number }> {
    const started = `${date}T12:00:00.000+0000`

    const body: Record<string, unknown> = {
      started,
      timeSpentSeconds,
    }

    if (comment && comment.trim().length > 0) {
      body['comment'] = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: comment.trim() }],
          },
        ],
      }
    }

    const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${issueKey}/worklog/${worklogId}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.status === 401 || res.status === 403) {
      throw new JiraUnauthorizedError(`Jira updateWorklog returned ${res.status}`)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Jira updateWorklog error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as { id: string; started: string; timeSpentSeconds: number }
    this.logger.log(
      `Jira worklog updated: id=${data.id} issue=${issueKey} date=${date} seconds=${timeSpentSeconds}`,
    )
    return { worklogId: data.id, started: data.started, timeSpentSeconds: data.timeSpentSeconds }
  }

  async deleteWorklog(
    userId: string,
    worklogId: string,
    issueKey: string,
  ): Promise<void> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.JIRA)
    const tokens = await this.credentials.getTokens(userId, ConnectorType.JIRA)

    const cloudId = meta.externalAccountId
    if (!cloudId) {
      throw new CredentialInvalidException(
        'Jira credential is missing cloudId. Please reconnect your Jira account.',
      )
    }

    return this.withJiraAuth(userId, tokens, meta.tokenExpiresAt, (token) =>
      this.deleteWorklogFromJira(token, cloudId, worklogId, issueKey),
    )
  }

  private async deleteWorklogFromJira(
    accessToken: string,
    cloudId: string,
    worklogId: string,
    issueKey: string,
  ): Promise<void> {
    const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/issue/${issueKey}/worklog/${worklogId}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (res.status === 401 || res.status === 403) {
      throw new JiraUnauthorizedError(`Jira deleteWorklog returned ${res.status}`)
    }
    if (res.status === 404) {
      this.logger.warn(`Jira deleteWorklog: worklog ${worklogId} not found, skipping`)
      return
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Jira deleteWorklog error ${res.status}: ${text}`)
    }
    this.logger.log(`Jira worklog deleted: id=${worklogId} issue=${issueKey}`)
  }

}

// ─── Error types ─────────────────────────────────────────────────────────────

export class JiraUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JiraUnauthorizedError'
  }
}

function isHttpUnauthorized(err: unknown): err is JiraUnauthorizedError {
  return err instanceof JiraUnauthorizedError
}
