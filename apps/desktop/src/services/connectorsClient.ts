import type { FindOrCreateProjectResponse } from '@houston/shared-types'

/**
 * Najde nebo vytvoří projekt podle Jira klíče (identu).
 * POST /projects/find-or-create
 */
export async function findOrCreateProjectByJiraKey(
  accessToken: string,
  jiraProjectKey: string,
): Promise<FindOrCreateProjectResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/projects/find-or-create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jiraProjectKey }),
  })
  const json = await response.json()
  return json as FindOrCreateProjectResponse
}
import { API_BASE_URL } from '../config/api'
import type {
  ConnectorInfo,
  ConnectorsListResponse,
  ConnectorType,
  JiraWorklogResponse,
  JiraWorklogStatsResponse,
  JiraWorklogDayResponse,
  ClockifyWorklogResponse,
  ClockifyWorklogDayResponse,
  HotSpotVacationResponse,
  MonthlyWorklogIssuesResponse,
  MonthlyIssueWorklogsResponse,
  AddWorklogRequest,
  AddWorklogResponse,
  AddClockifyWorklogRequest,
  AddClockifyWorklogResponse,
  UpdateWorklogRequest,
  UpdateWorklogResponse,
} from '@houston/shared-types'

export async function connectHotSpot(
  accessToken: string,
  apiKey: string,
  employeeId: string,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/connectors/hotspot/connect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ apiKey, employeeId }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `HOT SPOT se nepodařilo připojit (${response.status})`)
  }
}

export async function fetchHotSpotVacation(
  accessToken: string,
  year: number,
  month: number,
  workingDayHours: number,
): Promise<HotSpotVacationResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const url = new URL(`${API_BASE_URL}/connectors/hotspot/vacation`)
  url.searchParams.set('year', String(year))
  url.searchParams.set('month', String(month))
  url.searchParams.set('workingDayHours', String(workingDayHours))
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Dovolenou se nepodařilo načíst (${response.status})`)
  const payload = await response.json() as { success?: boolean; data?: HotSpotVacationResponse }
  if (payload.success !== true || !payload.data || typeof payload.data.seconds !== 'number') {
    throw new Error('HOT SPOT vrátil neplatnou odpověď')
  }
  return payload.data
}

/** Allowed OAuth provider hostnames for connector authorization flows. */
const ALLOWED_OAUTH_HOSTNAMES: readonly string[] = [
  'accounts.google.com',
  'slack.com',
  'www.slack.com',
  'auth.atlassian.com',
]

/**
 * Validates that an OAuth authorization URL is from a known, allowed provider.
 * Throws if the URL is invalid, non-HTTPS, or from an unexpected host.
 */
export function validateConnectorAuthUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid connector authorization URL received from server')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Connector authorization URL must use HTTPS')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_OAUTH_HOSTNAMES.includes(hostname)) {
    throw new Error(
      `Connector authorization URL from unexpected host: ${hostname}. ` +
        `Expected one of: ${ALLOWED_OAUTH_HOSTNAMES.join(', ')}`,
    )
  }

  return parsed
}

/**
 * Initiates an OAuth connection for the given connector.
 * Returns a validated authorization URL to open in the system browser.
 *
 * POST /connectors/:type/connect → { authUrl: string }
 */
export async function initiateConnectorConnect(
  accessToken: string,
  type: ConnectorType,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/connectors/${type}/connect`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => String(response.status))
    throw new Error(`Failed to initiate ${type} connection: ${text}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as Record<string, unknown>).authUrl !== 'string'
  ) {
    throw new Error('Invalid connect response from server')
  }

  const authUrl = (json as Record<string, unknown>).authUrl as string

  // Validate URL is from an expected OAuth provider before returning
  validateConnectorAuthUrl(authUrl)

  return authUrl
}

/**
 * Disconnects (revokes) the given connector for the current user.
 *
 * POST /connectors/:type/disconnect → 204 No Content
 */
export async function disconnectConnector(accessToken: string, type: ConnectorType): Promise<void> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/connectors/${type}/disconnect`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => String(response.status))
    throw new Error(`Failed to disconnect ${type}: ${text}`)
  }
}

/**
 * Validates that a raw value matches the ConnectorInfo shape.
 */
function isConnectorInfo(v: unknown): v is ConnectorInfo {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  const validStatuses = ['connected', 'not_connected', 'token_expired', 'error', 'warning']
  return (
    typeof obj.id === 'string' &&
    typeof obj.label === 'string' &&
    typeof obj.status === 'string' &&
    validStatuses.includes(obj.status) &&
    (obj.unreadCount === null || typeof obj.unreadCount === 'number') &&
    (obj.lastCheckedAt === null || typeof obj.lastCheckedAt === 'string')
  )
}

/**
 * Fetches the list of connectors (with cached unread counts) from the backend.
 *
 * In development mode the backend accepts unauthenticated requests (dev-user-placeholder).
 * Pass an empty string for accessToken when not authenticated.
 */
export async function fetchConnectors(accessToken: string): Promise<ConnectorsListResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/connectors`, { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch connectors: ${response.status}`)
  }

  const json: unknown = await response.json()

  // Runtime validation of ApiSuccess<ConnectorsListResponse> shape
  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json) ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid response from server')
  }

  const data = (json as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null || !('connectors' in data)) {
    throw new Error('Invalid connectors data from server')
  }

  const connectors = (data as Record<string, unknown>).connectors
  if (!Array.isArray(connectors) || !connectors.every(isConnectorInfo)) {
    throw new Error('Invalid connector list from server')
  }

  return { connectors }
}

/**
 * Triggers a live unread-count refresh for a specific connector on the backend,
 * then returns the updated ConnectorInfo.
 */
export async function refreshConnectorUnread(
  accessToken: string,
  connectorType: string,
): Promise<ConnectorInfo> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const response = await fetch(`${API_BASE_URL}/connectors/${connectorType}/refresh-unread`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    throw new Error(`Failed to refresh connector: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json) ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid response from server')
  }

  const data = (json as Record<string, unknown>).data
  if (!isConnectorInfo(data)) {
    throw new Error('Invalid connector data from server')
  }

  return data
}

/**
 * Fetches per-day worklog seconds from Jira for the given year/month.
 *
 * GET /connectors/jira/worklogs?year=YYYY&month=M
 * → { success: true, data: { year, month, secondsPerDay } }
 */
export async function fetchJiraWorklogs(
  accessToken: string,
  year: number,
  month: number,
): Promise<JiraWorklogResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/jira/worklogs`)
  url.searchParams.set('year', String(year))
  url.searchParams.set('month', String(month))

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch Jira worklogs: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid Jira worklogs response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (
    typeof data.year !== 'number' ||
    typeof data.month !== 'number' ||
    typeof data.secondsPerDay !== 'object' ||
    data.secondsPerDay === null
  ) {
    throw new Error('Invalid Jira worklogs data shape')
  }

  return {
    year: data.year,
    month: data.month,
    secondsPerDay: data.secondsPerDay as Record<number, number>,
  }
}

/** Fetches all historical Jira worklog totals for the authenticated user. */
export async function fetchJiraWorklogStats(accessToken: string): Promise<JiraWorklogStatsResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/connectors/jira/worklogs/stats`, { headers })
  if (!response.ok) {
    throw new Error(`Failed to fetch Jira worklog stats: ${response.status}`)
  }

  const json: unknown = await response.json()
  if (
    typeof json !== 'object' ||
    json === null ||
    (json as Record<string, unknown>).success !== true ||
    typeof (json as Record<string, unknown>).data !== 'object' ||
    (json as Record<string, unknown>).data === null
  ) {
    throw new Error('Invalid Jira worklog stats response from server')
  }

  const data = (json as { data: Record<string, unknown> }).data
  if (typeof data.count !== 'number' || typeof data.seconds !== 'number') {
    throw new Error('Invalid Jira worklog stats data shape')
  }
  return { count: data.count, seconds: data.seconds }
}

/**
 * Adds a worklog entry to a Jira issue.
 *
 * POST /connectors/jira/worklogs
 * → { success: true, data: { worklogId, started, timeSpentSeconds } }
 */
export async function addJiraWorklog(
  accessToken: string,
  body: AddWorklogRequest,
): Promise<AddWorklogResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/connectors/jira/worklogs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Worklog se nepodařilo uložit (${response.status})`
    try {
      const errJson = (await response.json()) as { message?: string }
      if (errJson.message) message = errJson.message
    } catch {
      // ignore parse error – keep default message
    }
    throw new Error(message)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid add-worklog response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.worklogId !== 'string' || typeof data.timeSpentSeconds !== 'number') {
    throw new Error('Invalid add-worklog data shape')
  }

  return {
    worklogId: data.worklogId,
    started: String(data.started),
    timeSpentSeconds: data.timeSpentSeconds,
  }
}

/**
 * Adds a worklog entry to Clockify.
 *
 * POST /connectors/clockify/worklogs
 * → { success: true, data: { worklogId, started, timeSpentSeconds } }
 */
export async function addClockifyWorklog(
  accessToken: string,
  body: AddClockifyWorklogRequest,
): Promise<AddClockifyWorklogResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/connectors/clockify/worklogs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Clockify worklog se nepodařilo uložit (${response.status})`
    try {
      const errJson = (await response.json()) as { message?: string }
      if (errJson.message) message = errJson.message
    } catch {
      // ignore parse error – keep default message
    }
    throw new Error(message)
  }

  const json: unknown = await response.json()
  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid add-clockify-worklog response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.worklogId !== 'string' || typeof data.timeSpentSeconds !== 'number') {
    throw new Error('Invalid add-clockify-worklog data shape')
  }

  return {
    worklogId: data.worklogId,
    started: String(data.started),
    timeSpentSeconds: data.timeSpentSeconds,
  }
}

/**
 * Updates an existing worklog entry in Jira.
 *
 * PUT /connectors/jira/worklogs/:worklogId
 * → { success: true, data: { worklogId, started, timeSpentSeconds } }
 */
export async function updateJiraWorklog(
  accessToken: string,
  worklogId: string,
  body: UpdateWorklogRequest,
): Promise<UpdateWorklogResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/connectors/jira/worklogs/${encodeURIComponent(worklogId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Worklog se nepodařilo aktualizovat (${response.status})`
    try {
      const errJson = (await response.json()) as { message?: string }
      if (errJson.message) message = errJson.message
    } catch {
      // ignore parse error – keep default message
    }
    throw new Error(message)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid update-worklog response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.worklogId !== 'string' || typeof data.timeSpentSeconds !== 'number') {
    throw new Error('Invalid update-worklog data shape')
  }

  return {
    worklogId: data.worklogId,
    started: String(data.started),
    timeSpentSeconds: data.timeSpentSeconds,
  }
}

/**
 * Deletes an existing worklog entry from Jira.
 *
 * DELETE /connectors/jira/worklogs/:worklogId?issueKey=...&oldTimeSpentSeconds=...
 */
export async function deleteJiraWorklog(
  accessToken: string,
  worklogId: string,
  issueKey: string,
  oldTimeSpentSeconds?: number,
): Promise<void> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const params = new URLSearchParams({ issueKey })
  if (oldTimeSpentSeconds != null) params.set('oldTimeSpentSeconds', String(oldTimeSpentSeconds))

  const response = await fetch(
    `${API_BASE_URL}/connectors/jira/worklogs/${encodeURIComponent(worklogId)}?${params.toString()}`,
    { method: 'DELETE', headers },
  )

  if (!response.ok && response.status !== 204) {
    let message = `Worklog se nepodařilo smazat (${response.status})`
    try {
      const errJson = (await response.json()) as { message?: string }
      if (errJson.message) message = errJson.message
    } catch {
      // ignore parse error – keep default message
    }
    throw new Error(message)
  }
}

/**
 * Connects Clockify using an API key.
 * Unlike OAuth connectors, there is no browser redirect – the key is sent directly.
 *
 * POST /connectors/clockify/connect
 * Body: { apiKey, workspaceId? }
 */
export async function connectClockifyWithApiKey(
  accessToken: string,
  apiKey: string,
  workspaceId?: string,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const body: Record<string, string> = { apiKey }
  if (workspaceId) body.workspaceId = workspaceId

  const response = await fetch(`${API_BASE_URL}/connectors/clockify/connect`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Failed to connect Clockify (${response.status})`
    try {
      const errJson = (await response.json()) as { message?: string }
      if (errJson.message) message = errJson.message
    } catch {
      // ignore parse error – keep default message
    }
    throw new Error(message)
  }
}

/**
 * Fetches per-day worklog seconds from Clockify for the given year/month.
 *
 * GET /connectors/clockify/worklogs?year=YYYY&month=M
 * → { success: true, data: { year, month, secondsPerDay } }
 */
export async function fetchClockifyWorklogs(
  accessToken: string,
  year: number,
  month: number,
): Promise<ClockifyWorklogResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/clockify/worklogs`)
  url.searchParams.set('year', String(year))
  url.searchParams.set('month', String(month))

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch Clockify worklogs: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid Clockify worklogs response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (
    typeof data.year !== 'number' ||
    typeof data.month !== 'number' ||
    typeof data.secondsPerDay !== 'object' ||
    data.secondsPerDay === null
  ) {
    throw new Error('Invalid Clockify worklogs data shape')
  }

  return {
    year: data.year,
    month: data.month,
    secondsPerDay: data.secondsPerDay as Record<number, number>,
  }
}

/**
 * Fetches aggregated issue list for the given month from Jira + Clockify.
 *
 * GET /connectors/worklogs/monthly-issues?year=YYYY&month=M
 * → { success: true, data: { year, month, issues } }
 */
export async function fetchMonthlyWorklogIssues(
  accessToken: string,
  year: number,
  month: number,
): Promise<MonthlyWorklogIssuesResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/worklogs/monthly-issues`)
  url.searchParams.set('year', String(year))
  url.searchParams.set('month', String(month))

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch monthly worklog issues: ${response.status}`)
  }

  const json: unknown = await response.json()
  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid monthly worklog issues response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.year !== 'number' || typeof data.month !== 'number' || !Array.isArray(data.issues)) {
    throw new Error('Invalid monthly worklog issues data shape')
  }

  for (const item of data.issues) {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Invalid monthly worklog issue item')
    }
    const obj = item as Record<string, unknown>
    if (
      (obj.source !== 'jira' && obj.source !== 'clockify') ||
      typeof obj.reference !== 'string' ||
      typeof obj.totalSeconds !== 'number'
    ) {
      throw new Error('Invalid monthly worklog issue item shape')
    }
  }

  return {
    year: data.year,
    month: data.month,
    issues: data.issues as MonthlyWorklogIssuesResponse['issues'],
  }
}

/**
 * Fetches individual worklog entries for a specific monthly issue (lazy-loaded on demand).
 *
 * GET /connectors/worklogs/monthly-issues/:source/:reference?year=YYYY&month=M
 * → { success: true, data: { year, month, source, reference, worklogs: MonthlyIssueWorklogEntry[] } }
 */
export async function fetchMonthlyIssueWorklogs(
  accessToken: string,
  year: number,
  month: number,
  source: 'jira' | 'clockify',
  reference: string,
): Promise<MonthlyIssueWorklogsResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(
    `${API_BASE_URL}/connectors/worklogs/monthly-issues/${encodeURIComponent(source)}/${encodeURIComponent(reference)}`,
  )
  url.searchParams.set('year', String(year))
  url.searchParams.set('month', String(month))

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch monthly issue worklogs: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid monthly issue worklogs response from server')
  }

  const d = (json as Record<string, unknown>).data as Record<string, unknown>
  if (!Array.isArray(d.worklogs)) {
    throw new Error('Invalid monthly issue worklogs data shape')
  }

  return {
    year: typeof d.year === 'number' ? d.year : year,
    month: typeof d.month === 'number' ? d.month : month,
    source: source,
    reference: reference,
    worklogs: d.worklogs as MonthlyIssueWorklogsResponse['worklogs'],
  }
}

/**
 * Fetches detailed Jira worklog entries for a specific day (lazy-loaded on demand).
 *
 * GET /connectors/jira/worklogs/day?date=YYYY-MM-DD
 * → { success: true, data: { date, worklogs: JiraWorklogDayEntry[] } }
 */
export async function fetchJiraWorklogsDay(
  accessToken: string,
  date: string,
): Promise<JiraWorklogDayResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/jira/worklogs/day`)
  url.searchParams.set('date', date)

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch Jira day worklogs: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid Jira day worklogs response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.date !== 'string' || !Array.isArray(data.worklogs)) {
    throw new Error('Invalid Jira day worklogs data shape')
  }

  return {
    date: data.date,
    worklogs: data.worklogs as JiraWorklogDayResponse['worklogs'],
  }
}

/**
 * Fetches detailed Clockify time entries for a specific day (lazy-loaded on demand).
 *
 * GET /connectors/clockify/worklogs/day?date=YYYY-MM-DD
 * → { success: true, data: { date, worklogs: ClockifyWorklogDayEntry[] } }
 */
export async function fetchClockifyWorklogsDay(
  accessToken: string,
  date: string,
): Promise<ClockifyWorklogDayResponse> {
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/clockify/worklogs/day`)
  url.searchParams.set('date', date)

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch Clockify day worklogs: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid Clockify day worklogs response from server')
  }

  const data = (json as Record<string, unknown>).data as Record<string, unknown>
  if (typeof data.date !== 'string' || !Array.isArray(data.worklogs)) {
    throw new Error('Invalid Clockify day worklogs data shape')
  }

  return {
    date: data.date,
    worklogs: data.worklogs as ClockifyWorklogDayResponse['worklogs'],
  }
}
