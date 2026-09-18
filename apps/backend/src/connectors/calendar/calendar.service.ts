/**
 * CalendarService
 *
 * Fetches Google Calendar events for a connected user.
 *
 * Features:
 *  - Proactive access-token refresh (within 5 min of expiry).
 *  - On 401 the credential is marked INVALID in DB.
 *  - Never exposes token values outside this service.
 *
 * Google Calendar API used:
 *  GET https://www.googleapis.com/calendar/v3/calendars/primary/events
 *    ?timeMin=<ISO>&timeMax=<ISO>&singleEvents=true&orderBy=startTime
 *
 * Required OAuth scopes: https://www.googleapis.com/auth/calendar.readonly
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
import { ConnectorCredentialsService } from '../connector-credentials.service'

const CALENDAR_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: string // ISO 8601
  end: string   // ISO 8601
  attendees: Array<{ email: string; displayName?: string; responseStatus?: string }>
  meetLink?: string
  allDay: boolean
  recurringEventId?: string
}

export interface CalendarEventsResult {
  events: CalendarEvent[]
  externalAccountId?: string
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name)

  constructor(
    private readonly credentials: ConnectorCredentialsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Return events in the given time window for the connected user.
   *
   * @throws CredentialNotFoundException  when no Calendar credential exists
   * @throws CredentialExpiredException   when the credential has expired and refresh fails
   * @throws CredentialInvalidException   when the credential has been revoked/invalidated
   */
  async getEvents(
    userId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<CalendarEventsResult> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    let accessToken = tokens.accessToken

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      this.logger.debug(`Calendar token near expiry for user=${userId} – refreshing proactively`)
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      const events = await this.fetchEvents(accessToken, timeMin, timeMax)
      return { events, externalAccountId: meta.externalAccountId ?? undefined }
    } catch (err: unknown) {
      if (isCalendarForbidden(err)) {
        // 403 = scope not granted (calendar.readonly missing) – re-authorisation needed.
        // Do NOT mark the credential INVALID: the Gmail token itself is still valid.
        this.logger.warn(`Calendar 403 for user=${userId} – calendar scope not granted. User must re-authorize.`)
        throw err
      }
      if (isCalendarUnauthorized(err)) {
        this.logger.warn(`Calendar 401 for user=${userId} – attempting token refresh`)
        try {
          accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
          const events = await this.fetchEvents(accessToken, timeMin, timeMax)
          return { events, externalAccountId: meta.externalAccountId ?? undefined }
        } catch (refreshErr: unknown) {
          await this.credentials.markInvalid(userId, ConnectorType.GMAIL)
          throw refreshErr
        }
      }
      throw err
    }
  }

  /**
   * Fetch a single calendar event by ID for the connected user.
   * Uses Google Calendar events.get endpoint and maps to CalendarEvent.
   */
  async getEvent(userId: string, eventId: string): Promise<CalendarEvent | null> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    let accessToken = tokens.accessToken
    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      const ev = await this.fetchEvent(accessToken, eventId)
      return ev
    } catch (err: unknown) {
      if (isCalendarForbidden(err) || isCalendarUnauthorized(err)) {
        // propagate so caller can decide; let controller handle refresh/invalidation
        throw err
      }
      this.logger.warn(`getEvent failed for user=${userId} event=${eventId}: ${(err as Error).message}`)
      return null
    }
  }

  /**
   * Search calendar events by keyword across a ±30-day window.
    * Combines Google's full-text search with local matching because `q` does not
    * reliably match organization names to attendee email domains.
   */
  async searchEvents(userId: string, query: string, maxResults = 20): Promise<CalendarEvent[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    let accessToken = tokens.accessToken
    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    try {
      return await this.fetchSearchResults(accessToken, timeMin, timeMax, query, maxResults)
    } catch (err: unknown) {
      if (isCalendarUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.fetchSearchResults(accessToken, timeMin, timeMax, query, maxResults)
      }
      if (isCalendarForbidden(err)) {
        this.logger.warn(`Calendar search 403 for user=${userId} – scope not granted`)
        return []
      }
      throw err
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchSearchResults(
    accessToken: string,
    timeMin: Date,
    timeMax: Date,
    query: string,
    maxResults: number,
  ): Promise<CalendarEvent[]> {
    const [googleMatches, nearbyEvents] = await Promise.all([
      this.fetchEvents(accessToken, timeMin, timeMax, { q: query, maxResults }),
      this.fetchEvents(accessToken, timeMin, timeMax, { maxResults: Math.max(maxResults, 250) }),
    ])
    const normalizedTerms = normalizeSearchText(query)
      .split(/\s+/)
      .filter((term) => term.length >= 3)
    const localMatches = nearbyEvents.filter((event) => {
      const searchableText = normalizeSearchText([
        event.summary,
        event.description,
        event.location,
        ...event.attendees.flatMap((attendee) => [attendee.email, attendee.displayName]),
      ].filter((value): value is string => Boolean(value)).join(' '))
      return normalizedTerms.some((term) => searchableText.includes(term))
    })

    const seen = new Set<string>()
    return [...googleMatches, ...localMatches]
      .filter((event) => !seen.has(event.id) && seen.add(event.id))
      .slice(0, maxResults)
  }

  private async fetchEvents(
    accessToken: string,
    timeMin: Date,
    timeMax: Date,
    options: { q?: string; maxResults?: number } = {},
  ): Promise<CalendarEvent[]> {
    const url = new URL(CALENDAR_EVENTS_BASE)
    url.searchParams.set('timeMin', timeMin.toISOString())
    url.searchParams.set('timeMax', timeMax.toISOString())
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', String(options.maxResults ?? 50))
    if (options.q) url.searchParams.set('q', options.q)

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 401) {
      throw new CalendarUnauthorizedError(`Calendar API returned 401`)
    }

    if (response.status === 403) {
      throw new CalendarForbiddenError(
        'Calendar API returned 403 – calendar.readonly scope may not be granted. Re-authorize Google connector.',
      )
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Calendar API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as { items?: RawEvent[] }
    return (data.items ?? []).map(mapEvent)
  }

  private async fetchEvent(accessToken: string, eventId: string): Promise<CalendarEvent> {
    const url = `${CALENDAR_EVENTS_BASE}/${encodeURIComponent(eventId)}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 401) {
      throw new CalendarUnauthorizedError(`Calendar API returned 401`)
    }

    if (response.status === 403) {
      throw new CalendarForbiddenError(
        'Calendar API returned 403 – calendar.readonly scope may not be granted. Re-authorize Google connector.',
      )
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Calendar API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as RawEvent
    return mapEvent(data)
  }

  async refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID')
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth client credentials not configured')
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errText = await response.text()
      this.logger.error(`Calendar token refresh failed for user=${userId}: ${errText}`)
      await this.credentials.markInvalid(userId, ConnectorType.GMAIL)
      throw new Error(`Calendar token refresh failed: ${errText}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number }
    const newAccessToken = data.access_token
    const expiresAt = data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined

    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)
    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.GMAIL,
      accessToken: newAccessToken,
      refreshToken,
      scopes: meta.scopes,
      externalAccountId: meta.externalAccountId ?? undefined,
      expiresAt,
    })

    this.logger.log(`Calendar access token refreshed for user=${userId}`)
    return newAccessToken
  }

  private isNearExpiry(tokenExpiresAt: Date | null): boolean {
    if (!tokenExpiresAt) return false
    return tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000
  }
}

// ─── Internal Google API shape ───────────────────────────────────────────────

interface RawEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  recurringEventId?: string
}

function mapEvent(raw: RawEvent): CalendarEvent {
  const start = raw.start?.dateTime ?? raw.start?.date ?? ''
  const end = raw.end?.dateTime ?? raw.end?.date ?? ''
  const allDay = !raw.start?.dateTime
  const meetLink = raw.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video',
  )?.uri

  return {
    id: raw.id,
    summary: raw.summary ?? '(no title)',
    description: raw.description,
    location: raw.location,
    start,
    end,
    attendees: (raw.attendees ?? []).map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
    })),
    meetLink,
    allDay,
    recurringEventId: raw.recurringEventId,
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// ─── Local error types ────────────────────────────────────────────────────────

export class CalendarUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarUnauthorizedError'
  }
}

export class CalendarForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarForbiddenError'
  }
}

function isCalendarUnauthorized(err: unknown): err is CalendarUnauthorizedError {
  return err instanceof CalendarUnauthorizedError
}

function isCalendarForbidden(err: unknown): err is CalendarForbiddenError {
  return err instanceof CalendarForbiddenError
}
