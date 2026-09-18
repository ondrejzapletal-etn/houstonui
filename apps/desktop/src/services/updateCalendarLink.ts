import { API_BASE_URL } from '../config/api'
import type { UpsertCalendarIssueLinkDto, CalendarIssueLinkDto } from '@houston/shared-types'

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function updateCalendarLink(
  accessToken: string | null | undefined,
  calendarEventId: string,
  body: UpsertCalendarIssueLinkDto,
): Promise<CalendarIssueLinkDto> {
  const response = await fetch(`${API_BASE_URL}/calendar-links/${encodeURIComponent(calendarEventId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Calendar link update failed: ${response.status}`)
  const json = (await response.json()) as { data: { link: CalendarIssueLinkDto } }
  return json.data.link
}
