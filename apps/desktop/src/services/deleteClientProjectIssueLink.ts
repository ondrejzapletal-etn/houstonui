import { API_BASE_URL } from '../config/api'
import type { ClientDto, ProjectDto, JiraIssueDto, CalendarIssueLinkDto } from '@houston/shared-types'

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function deleteClient(accessToken: string | null | undefined, id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Client delete failed: ${response.status}`)
}

export async function deleteProject(accessToken: string | null | undefined, id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Project delete failed: ${response.status}`)
}

export async function deleteIssue(accessToken: string | null | undefined, id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/issues/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Issue delete failed: ${response.status}`)
}

export async function deleteCalendarLink(accessToken: string | null | undefined, calendarEventId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/calendar-links/${encodeURIComponent(calendarEventId)}`, {
    method: 'DELETE',
    headers: { ...authHeader(accessToken) },
  })
  if (!response.ok) throw new Error(`Calendar link delete failed: ${response.status}`)
}
