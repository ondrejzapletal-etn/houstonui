import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchConnectors,
  refreshConnectorUnread,
  validateConnectorAuthUrl,
  initiateConnectorConnect,
  disconnectConnector,
} from './connectorsClient'
import type { ConnectorInfo } from '@houston/shared-types'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const gmailConnector: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'connected',
  unreadCount: 5,
  lastCheckedAt: '2026-05-07T10:00:00.000Z',
}

const slackConnector: ConnectorInfo = {
  id: 'slack',
  label: 'Slack',
  status: 'not_connected',
  unreadCount: null,
  lastCheckedAt: null,
}

function makeSuccessResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ success: true, data }),
  }
}

// ─── fetchConnectors ──────────────────────────────────────────────────────────

describe('fetchConnectors', () => {
  it('returns connectors array on valid response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse({ connectors: [gmailConnector, slackConnector] }),
    )

    const result = await fetchConnectors('token-abc')
    expect(result.connectors).toHaveLength(2)
    expect(result.connectors[0]).toMatchObject({ id: 'gmail', unreadCount: 5 })
  })

  it('sends Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({ connectors: [] }))

    await fetchConnectors('my-secret-token')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/connectors'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-secret-token' }),
      }),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(fetchConnectors('token')).rejects.toThrow('401')
  })

  it('throws on success:false response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: { message: 'Unauthorized' } }),
    })
    await expect(fetchConnectors('token')).rejects.toThrow('Invalid response from server')
  })

  it('throws when data.connectors is missing', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({ other: 'stuff' }))
    await expect(fetchConnectors('token')).rejects.toThrow('Invalid connectors data from server')
  })

  it('throws when a connector entry has invalid shape', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse({ connectors: [{ id: 'gmail', label: 'Gmail' }] }), // missing fields
    )
    await expect(fetchConnectors('token')).rejects.toThrow('Invalid connector list from server')
  })

  it('throws when status is an unknown value', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse({
        connectors: [{ ...gmailConnector, status: 'weird_status' }],
      }),
    )
    await expect(fetchConnectors('token')).rejects.toThrow('Invalid connector list from server')
  })

  it('accepts the HOT SPOT VPN warning status', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse({
        connectors: [{
          id: 'hotspot',
          label: 'Hot Spot',
          status: 'warning',
          unreadCount: null,
          lastCheckedAt: null,
          errorMessage: 'Interní síť není dostupná, připoj se na VPN',
        }],
      }),
    )

    await expect(fetchConnectors('token')).resolves.toEqual(expect.objectContaining({
      connectors: [expect.objectContaining({ status: 'warning' })],
    }))
  })
})

// ─── validateConnectorAuthUrl ─────────────────────────────────────────────────

describe('validateConnectorAuthUrl', () => {
  it('accepts Google OAuth URL', () => {
    const url = validateConnectorAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
    expect(url.hostname).toBe('accounts.google.com')
  })

  it('accepts Slack OAuth URL', () => {
    const url = validateConnectorAuthUrl('https://slack.com/oauth/v2/authorize?client_id=x')
    expect(url.hostname).toBe('slack.com')
  })

  it('throws for non-HTTPS URL', () => {
    expect(() => validateConnectorAuthUrl('http://accounts.google.com/auth')).toThrow(
      'must use HTTPS',
    )
  })

  it('throws for unknown host', () => {
    expect(() => validateConnectorAuthUrl('https://evil.example.com/oauth')).toThrow(
      'unexpected host',
    )
  })

  it('throws for malformed URL', () => {
    expect(() => validateConnectorAuthUrl('not-a-url')).toThrow(
      'Invalid connector authorization URL',
    )
  })
})

// ─── initiateConnectorConnect ─────────────────────────────────────────────────

describe('initiateConnectorConnect', () => {
  it('returns a validated authUrl on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      }),
    })

    const authUrl = await initiateConnectorConnect('token', 'gmail')
    expect(authUrl).toContain('accounts.google.com')
  })

  it('sends POST with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authUrl: 'https://slack.com/oauth/v2/authorize?client_id=x' }),
    })

    await initiateConnectorConnect('my-token', 'slack')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/connectors/slack/connect'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    })
    await expect(initiateConnectorConnect('token', 'gmail')).rejects.toThrow('gmail connection')
  })

  it('throws when authUrl is missing from response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    await expect(initiateConnectorConnect('token', 'gmail')).rejects.toThrow(
      'Invalid connect response',
    )
  })

  it('throws when authUrl is from an unexpected host', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authUrl: 'https://evil.example.com/auth' }),
    })
    await expect(initiateConnectorConnect('token', 'gmail')).rejects.toThrow('unexpected host')
  })
})

// ─── disconnectConnector ──────────────────────────────────────────────────────

describe('disconnectConnector', () => {
  it('sends POST to disconnect endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })

    await disconnectConnector('my-token', 'gmail')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/connectors/gmail/disconnect'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })
    await expect(disconnectConnector('token', 'slack')).rejects.toThrow('slack')
  })
})

describe('refreshConnectorUnread', () => {
  it('returns updated ConnectorInfo on success', async () => {
    const updated = { ...gmailConnector, unreadCount: 12 }
    mockFetch.mockResolvedValueOnce(makeSuccessResponse(updated))

    const result = await refreshConnectorUnread('token', 'gmail')
    expect(result.unreadCount).toBe(12)
  })

  it('calls the correct endpoint with POST', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse(gmailConnector))

    await refreshConnectorUnread('token', 'gmail')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/connectors/gmail/refresh-unread'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(refreshConnectorUnread('token', 'gmail')).rejects.toThrow('500')
  })

  it('throws when returned data is not a valid ConnectorInfo', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse({ id: 'gmail' })) // incomplete
    await expect(refreshConnectorUnread('token', 'gmail')).rejects.toThrow(
      'Invalid connector data from server',
    )
  })
})
