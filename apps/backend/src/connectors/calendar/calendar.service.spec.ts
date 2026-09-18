/**
 * CalendarService – unit tests
 *
 * Key invariant: CalendarService reads/writes credentials under ConnectorType.GMAIL
 * (not CALENDAR) because Google Calendar and Gmail share a single OAuth token.
 *
 * Tests cover:
 *  - getEvents: happy path using GMAIL credential, proactive token refresh,
 *    401 → refresh → success, 401 → refresh failure → markInvalid(GMAIL)
 *  - refreshAccessToken: success stores under GMAIL, HTTP failure marks GMAIL invalid
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
import { CalendarService } from './calendar.service'
import { ConnectorCredentialsService } from '../connector-credentials.service'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCredentials = {
  getTokens: jest.fn(),
  getMetadata: jest.fn(),
  storeCredential: jest.fn(),
  markInvalid: jest.fn(),
}

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      GMAIL_CLIENT_ID: 'test-client-id',
      GMAIL_CLIENT_SECRET: 'test-client-secret',
    }
    return map[key]
  }),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokens(overrides: Partial<{ accessToken: string; refreshToken: string }> = {}) {
  return {
    accessToken: 'access-tok',
    refreshToken: 'refresh-tok',
    obtainedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeMeta(overrides: Partial<{ tokenExpiresAt: Date | null; externalAccountId: string }> = {}) {
  return {
    id: 'cred-1',
    userId: 'user-1',
    connectorType: ConnectorType.GMAIL,
    status: 'ACTIVE',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    externalAccountId: 'user@gmail.com',
    tokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeEventsResponse(items: object[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items }),
    text: async () => '',
  } as Response
}

function makeStatusResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
  } as Response
}

const TIME_MIN = new Date('2026-05-12T00:00:00Z')
const TIME_MAX = new Date('2026-05-19T00:00:00Z')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CalendarService', () => {
  let service: CalendarService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: ConnectorCredentialsService, useValue: mockCredentials },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get(CalendarService)
  })

  // ── Credential isolation: must always use GMAIL not CALENDAR ──────────────

  it('reads tokens from ConnectorType.GMAIL (not CALENDAR)', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
    global.fetch = jest.fn().mockResolvedValueOnce(makeEventsResponse())

    await service.getEvents('user-1', TIME_MIN, TIME_MAX)

    expect(mockCredentials.getTokens).toHaveBeenCalledWith('user-1', ConnectorType.GMAIL)
    expect(mockCredentials.getMetadata).toHaveBeenCalledWith('user-1', ConnectorType.GMAIL)
    expect(mockCredentials.getTokens).not.toHaveBeenCalledWith('user-1', ConnectorType.CALENDAR)
  })

  // ── getEvents: happy path ─────────────────────────────────────────────────

  it('returns mapped events on success', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

    const rawEvent = {
      id: 'evt-1',
      summary: 'Team standup',
      start: { dateTime: '2026-05-13T09:00:00Z' },
      end: { dateTime: '2026-05-13T09:30:00Z' },
      attendees: [{ email: 'bob@example.com', displayName: 'Bob', responseStatus: 'accepted' }],
    }
    global.fetch = jest.fn().mockResolvedValueOnce(makeEventsResponse([rawEvent]))

    const result = await service.getEvents('user-1', TIME_MIN, TIME_MAX)

    expect(result.events).toHaveLength(1)
    expect(result.events[0].summary).toBe('Team standup')
    expect(result.events[0].allDay).toBe(false)
    expect(result.externalAccountId).toBe('user@gmail.com')
  })

  it('returns empty array when no events (no items key)', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as Response)

    const result = await service.getEvents('user-1', TIME_MIN, TIME_MAX)
    expect(result.events).toHaveLength(0)
  })

  it('finds an event by an attendee email domain when the title does not contain the organization', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

    const cezEvent = {
      id: 'evt-cez',
      summary: 'Nové formy strukturované komunikace',
      start: { dateTime: '2026-09-15T09:00:00Z' },
      end: { dateTime: '2026-09-15T10:00:00Z' },
      attendees: [{ email: 'david.levy@cez.cz', displayName: 'David Levý' }],
    }
    const unrelatedEvent = {
      id: 'evt-other',
      summary: 'Interní synchronizace',
      start: { dateTime: '2026-09-15T11:00:00Z' },
      end: { dateTime: '2026-09-15T11:30:00Z' },
      attendees: [{ email: 'colleague@example.com' }],
    }
    global.fetch = jest.fn()
      .mockResolvedValueOnce(makeEventsResponse())
      .mockResolvedValueOnce(makeEventsResponse([cezEvent, unrelatedEvent]))

    const result = await service.searchEvents('user-1', 'ČEZ úterní schůzka')

    expect(result.map((event) => event.id)).toEqual(['evt-cez'])
  })

  // ── getEvents: proactive token refresh ────────────────────────────────────

  it('proactively refreshes token when near expiry', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000) // 2 min from now
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValue(makeMeta({ tokenExpiresAt: nearExpiry }))
    mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

    global.fetch = jest
      .fn()
      // 1st call: token refresh
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'new-tok', expires_in: 3600 }),
        text: async () => '',
      } as Response)
      // 2nd call: calendar events
      .mockResolvedValueOnce(makeEventsResponse())

    await service.getEvents('user-1', TIME_MIN, TIME_MAX)

    expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ connectorType: ConnectorType.GMAIL, accessToken: 'new-tok' }),
    )
  })

  // ── getEvents: 401 → refresh → retry ─────────────────────────────────────

  it('retries with refreshed token on 401 response', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValue(makeMeta())
    mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

    global.fetch = jest
      .fn()
      // 1st calendar call → 401
      .mockResolvedValueOnce(makeStatusResponse(401))
      // token refresh
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'refreshed-tok', expires_in: 3600 }),
        text: async () => '',
      } as Response)
      // 2nd calendar call → success
      .mockResolvedValueOnce(makeEventsResponse())

    const result = await service.getEvents('user-1', TIME_MIN, TIME_MAX)
    expect(result.events).toBeDefined()
  })

  // ── getEvents: 401 + refresh failure → markInvalid(GMAIL) ────────────────

  it('marks GMAIL credential INVALID when refresh fails after 401', async () => {
    mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
    mockCredentials.getMetadata.mockResolvedValue(makeMeta())
    mockCredentials.markInvalid.mockResolvedValueOnce(undefined)

    global.fetch = jest
      .fn()
      // 1st calendar call → 401
      .mockResolvedValueOnce(makeStatusResponse(401))
      // token refresh → failure
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'invalid_grant',
      } as Response)

    await expect(service.getEvents('user-1', TIME_MIN, TIME_MAX)).rejects.toThrow()

    expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.GMAIL)
    expect(mockCredentials.markInvalid).not.toHaveBeenCalledWith('user-1', ConnectorType.CALENDAR)
  })

  // ── refreshAccessToken: storeCredential uses GMAIL ────────────────────────

  it('stores refreshed token under ConnectorType.GMAIL', async () => {
    mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
    mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'brand-new', expires_in: 3600 }),
      text: async () => '',
    } as Response)

    await service.refreshAccessToken('user-1', 'old-refresh')

    expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        connectorType: ConnectorType.GMAIL,
        accessToken: 'brand-new',
      }),
    )
  })
})
