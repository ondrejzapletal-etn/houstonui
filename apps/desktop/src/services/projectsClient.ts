import { API_BASE_URL } from '../config/api'
import type {
  ClientDto,
  ProjectDto,
  JiraIssueDto,
  CalendarIssueLinkDto,
  UpsertCalendarIssueLinkDto,
  CreateClientDto,
  CreateProjectDto,
} from '@houston/shared-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export async function fetchClients(accessToken: string | null | undefined): Promise<ClientDto[]> {
  const response = await fetch(`${API_BASE_URL}/clients`, {
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Clients fetch failed: ${response.status}`)
  const json = (await response.json()) as { data: { clients: ClientDto[] } }
  return json.data.clients
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function createClient(
  accessToken: string | null | undefined,
  body: CreateClientDto,
): Promise<ClientDto> {
  const response = await fetch(`${API_BASE_URL}/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Client create failed: ${response.status}`)
  const json = (await response.json()) as { data: { client: ClientDto } }
  return json.data.client
}

export async function fetchProjects(accessToken: string | null | undefined): Promise<ProjectDto[]> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Projects fetch failed: ${response.status}`)
  const json = (await response.json()) as { data: { projects: ProjectDto[] } }
  return json.data.projects
}

// ─── Issues ──────────────────────────────────────────────────────────────────

export async function createProject(
  accessToken: string | null | undefined,
  body: CreateProjectDto,
): Promise<ProjectDto> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Project create failed: ${response.status}`)
  const json = (await response.json()) as { data: { project: ProjectDto } }
  return json.data.project
}

export async function searchIssues(
  accessToken: string | null | undefined,
  search?: string,
  projectId?: string,
  includeInactive?: boolean,
): Promise<JiraIssueDto[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (projectId) params.set('projectId', projectId)
  if (includeInactive) params.set('includeInactive', 'true')

  const response = await fetch(
    `${API_BASE_URL}/issues${params.size ? `?${params}` : ''}`,
    { headers: { ...authHeader(accessToken) } },
  )
  if (!response.ok) throw new Error(`Issues search failed: ${response.status}`)
  const json = (await response.json()) as { data: { issues: JiraIssueDto[] } }
  return json.data.issues
}

export async function upsertIssue(
  accessToken: string | null | undefined,
  body: { issueKey: string; summary: string; projectId?: string },
): Promise<JiraIssueDto> {
  const response = await fetch(`${API_BASE_URL}/issues`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Issue upsert failed: ${response.status}`)
  const json = (await response.json()) as { data: { issue: JiraIssueDto } }
  return json.data.issue
}

// ─── Calendar-Issue Links ─────────────────────────────────────────────────────

export async function fetchAllCalendarLinks(accessToken: string | null | undefined): Promise<CalendarIssueLinkDto[]> {
  const response = await fetch(`${API_BASE_URL}/calendar-links`, {
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Calendar links fetch failed: ${response.status}`)
  const json = (await response.json()) as { data: { links: CalendarIssueLinkDto[] } }
  return json.data.links
}

export async function fetchCalendarLink(
  accessToken: string | null | undefined,
  calendarEventId: string,
  recurringEventId?: string,
): Promise<CalendarIssueLinkDto | null> {
  const url = new URL(`${API_BASE_URL}/calendar-links/${encodeURIComponent(calendarEventId)}`)
  if (recurringEventId) url.searchParams.set('recurringEventId', recurringEventId)
  const response = await fetch(url.toString(), { headers: { ...authHeader(accessToken) } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Calendar link fetch failed: ${response.status}`)
  const json = (await response.json()) as { data: { link: CalendarIssueLinkDto | null } }
  return json.data.link
}

export async function upsertCalendarLink(
  accessToken: string | null | undefined,
  calendarEventId: string,
  body: UpsertCalendarIssueLinkDto,
): Promise<CalendarIssueLinkDto> {
  const response = await fetch(
    `${API_BASE_URL}/calendar-links/${encodeURIComponent(calendarEventId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(accessToken),
      },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) throw new Error(`Calendar link upsert failed: ${response.status}`)
  const json = (await response.json()) as { data: { link: CalendarIssueLinkDto } }
  return json.data.link
}

export interface IssueSuggestion {
  client: { id: string; name: string } | null
  unknownDomain: string | null
  issues: { issueKey: string; summary: string }[]
}

export async function fetchIssueSuggestion(
  accessToken: string | null | undefined,
  emails: string[],
): Promise<IssueSuggestion> {
  const url = new URL(`${API_BASE_URL}/calendar-links/suggest-issue`)
  emails.forEach(e => url.searchParams.append('email', e))
  const response = await fetch(url.toString(), { headers: { ...authHeader(accessToken) } })
  if (!response.ok) throw new Error(`Issue suggestion fetch failed: ${response.status}`)
  const json = (await response.json()) as { data: IssueSuggestion }
  return json.data
}
