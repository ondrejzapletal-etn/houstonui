import { API_BASE_URL } from '../config/api'

/**
 * Fetch calendar events for a given time window.
 * GET /api/v1/calendar/events?timeMin=...&timeMax=...
 */
export async function fetchCalendarRange(accessToken: string, timeMin: string, timeMax: string) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/calendar/events`)
  url.searchParams.set('timeMin', timeMin)
  url.searchParams.set('timeMax', timeMax)

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Calendar fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = await response.json()
  return json.data ?? json
}

export default { fetchCalendarRange }

export interface DailySentEmail {
  messageId: string
  subject: string
  to: string
  snippet: string
  sentAt: string
}

export interface DailySentSlackMessage {
  channelId: string
  channelName?: string
  text: string
  ts: string
  permalink?: string
}

export interface DailyActivityData {
  sentEmails: DailySentEmail[]
  sentSlackMessages: DailySentSlackMessage[]
}

export async function fetchDailyActivity(accessToken: string, date: string): Promise<DailyActivityData> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/daily-activity`)
  url.searchParams.set('date', date)

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Daily activity fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = await response.json()
  const data = json.data ?? json
  return {
    sentEmails: data.sentEmails ?? [],
    sentSlackMessages: data.sentSlackMessages ?? [],
  }
}

export async function fetchCalendarEvent(accessToken: string, id: string) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const url = new URL(`${API_BASE_URL}/connectors/calendar/event`)
  url.searchParams.set('id', id)

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Calendar event fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = await response.json()
  return json.data?.event ?? null
}
