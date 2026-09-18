/**
 * GmailService – unit tests
 *
 * Tests cover:
 *  - getUnreadCount: happy path, proactive token refresh, 401 → refresh → success,
 *    401 → refresh failure → markInvalid, non-auth errors propagate
 *  - refreshAccessToken: success (stores new token), HTTP failure (marks invalid + throws),
 *    missing client config throws
 *
 * No real HTTP calls – global fetch is mocked per test.
 * No Key Vault or DB calls – ConnectorCredentialsService is fully mocked.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
import { GmailService, GmailUnauthorizedError } from './gmail.service'
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
    ...overrides,
  }
}

function makeMeta(
  overrides: Partial<{ tokenExpiresAt: Date | null; externalAccountId: string }> = {},
) {
  return {
    id: 'cred-1',
    userId: 'user-1',
    connectorType: ConnectorType.GMAIL,
    status: 'ACTIVE',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    externalAccountId: 'user@gmail.com',
    tokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function mockFetch(ok: boolean, body: object | string) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 400,
    json: async () => (typeof body === 'object' ? body : JSON.parse(body as string)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response)
}

function mockFetchStatus(status: number) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
  } as Response)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GmailService', () => {
  let service: GmailService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailService,
        { provide: ConnectorCredentialsService, useValue: mockCredentials },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get(GmailService)
  })

  describe('fetchScanEmails', () => {
    it('parses a Docs mention from an HTML-only notification body', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta({
        externalAccountId: 'signed.in@example.com',
      }))
      const html = [
        '<div>@signed.in&#64;example.com please review this.</div>',
        '<a href="https://docs.google.com/document/d/html-document/edit?disco=comment-1">Open</a>',
      ].join('')
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'html-docs-comment' }] }),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'html-docs-comment',
            snippet: '',
            payload: {
              mimeType: 'text/html',
              body: { data: Buffer.from(html).toString('base64url') },
              headers: [
                { name: 'From', value: 'Google Docs <comments-noreply@docs.google.com>' },
                { name: 'Subject', value: 'New comment in "Houston"' },
              ],
            },
          }),
          text: async () => '',
        } as Response)

      const result = await service.fetchScanEmails('user-1')

      expect(result[0].googleDocsComment).toEqual(expect.objectContaining({
        documentId: 'html-document',
        mentionsCurrentUser: true,
      }))
    })

    it('uses the connected Gmail identity when parsing Google Docs mentions', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta({
        externalAccountId: 'signed.in@example.com',
      }))
      const body = [
        '@signed.in@example.com please review this.',
        'https://docs.google.com/document/d/document-123/edit',
      ].join('\n')
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'docs-comment' }] }),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'docs-comment',
            payload: {
              mimeType: 'text/plain',
              body: { data: Buffer.from(body).toString('base64url') },
              headers: [
                { name: 'From', value: 'Google Docs <comments-noreply@docs.google.com>' },
                { name: 'Subject', value: 'Comment in "Houston"' },
              ],
            },
          }),
          text: async () => '',
        } as Response)

      const result = await service.fetchScanEmails('user-1')

      expect(result[0].googleDocsComment).toEqual(expect.objectContaining({
        documentId: 'document-123',
        mentionsCurrentUser: true,
        mentionsOtherUsers: false,
      }))
    })

    it('excludes messages sent by the connected account', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'self' }, { id: 'other' }] }),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'self',
            payload: { headers: [{ name: 'From', value: 'User <USER@gmail.com>' }] },
          }),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'other',
            payload: { headers: [{ name: 'From', value: 'colleague@example.com' }] },
          }),
          text: async () => '',
        } as Response)

      const result = await service.fetchScanEmails('user-1')

      expect(result.map((email) => email.messageId)).toEqual(['other'])
      const listUrl = String((global.fetch as jest.Mock).mock.calls[0][0])
      expect(new URL(listUrl).searchParams.get('q')).toBe('is:unread -in:spam -in:trash -from:me')
    })

    it('fetches both read and unread inbox messages for the source preview', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
        text: async () => '',
      } as Response)

      await service.fetchPreviewEmails('user-1')

      const listUrl = String((global.fetch as jest.Mock).mock.calls[0][0])
      expect(new URL(listUrl).searchParams.get('q')).toBe('in:inbox -in:spam -in:trash -from:me')
    })

    it('keeps all senders when the connected account identity is unavailable', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta({ externalAccountId: '' }))
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'message-1' }] }),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'message-1',
            payload: { headers: [{ name: 'From', value: 'user@gmail.com' }] },
          }),
          text: async () => '',
        } as Response)

      const result = await service.fetchScanEmails('user-1')

      expect(result).toHaveLength(1)
    })
  })

  describe('reply actions', () => {
    it('marks a bounded set of Gmail messages as read with batchModify', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockFetch(true, {})

      await service.markMessagesAsRead('user-1', ['message-1', 'message-2', 'message-1'])

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages/batchModify'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ids: ['message-1', 'message-2'],
            removeLabelIds: ['UNREAD'],
          }),
        }),
      )
    })

    it('decodes an RFC 2047 subject before composing a reply', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockFetch(true, {
        id: 'message-1',
        threadId: 'thread-1',
        payload: {
          headers: [
            { name: 'Message-ID', value: '<message-1@example.com>' },
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'To', value: 'User <user@gmail.com>' },
            { name: 'Subject', value: '=?UTF-8?B?xIxsw6Fua3kgYSBaUA==?=' },
          ],
        },
      })

      const details = await service.getMessageDetails('user-1', 'message-1')

      expect(details.subject).toBe('Články a ZP')
    })

    it('MIME-encodes a non-ASCII reply subject', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockFetch(true, {})

      await service.sendReply('user-1', {
        threadId: 'thread-1',
        rfcMessageId: '<message-1@example.com>',
        to: 'sender@example.com',
        subject: 'Články a ZP',
        body: 'Děkuji.',
      })

      const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
      const raw = JSON.parse(request.body as string).raw as string
      const mime = Buffer.from(raw, 'base64url').toString('utf8')
      expect(mime).toContain('Subject: =?UTF-8?B?UmU6IMSMbMOhbmt5IGEgWlA=?=')
    })
  })

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns unread count from resultSizeEstimate on success', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockFetch(true, { resultSizeEstimate: 42, threads: [] })

      const result = await service.getUnreadCount('user-1')

      expect(result.unreadCount).toBe(42)
      expect(result.externalAccountId).toBe('user@gmail.com')
    })

    it('returns 0 when inbox is empty (no resultSizeEstimate, no threads)', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockFetch(true, {})

      const result = await service.getUnreadCount('user-1')

      expect(result.unreadCount).toBe(0)
    })

    it('proactively refreshes token when near expiry', async () => {
      const nearExpiry = new Date(Date.now() + 2 * 60 * 1000) // 2 min from now
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValue(makeMeta({ tokenExpiresAt: nearExpiry }))

      // First fetch call: token refresh
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'new-access-tok', expires_in: 3600 }),
          text: async () => '',
        } as Response)
        // Second fetch call: gmail threads
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ resultSizeEstimate: 5 }),
          text: async () => '',
        } as Response)

      mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

      const result = await service.getUnreadCount('user-1')

      expect(result.unreadCount).toBe(5)
      expect(mockCredentials.storeCredential).toHaveBeenCalled()
    })

    it('retries with refreshed token on 401 response', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())

      // First Gmail API call → 401
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => '',
        } as Response)
        // Token refresh
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'refreshed-tok', expires_in: 3600 }),
          text: async () => '',
        } as Response)
        // Retry Gmail API call → success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ resultSizeEstimate: 7 }),
          text: async () => '',
        } as Response)

      mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

      const result = await service.getUnreadCount('user-1')

      expect(result.unreadCount).toBe(7)
    })

    it('marks credential INVALID when refresh also fails after 401', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.markInvalid.mockResolvedValueOnce(undefined)

      // First Gmail API call → 401
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => '',
        } as Response)
        // Token refresh fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => 'invalid_grant',
        } as Response)

      await expect(service.getUnreadCount('user-1')).rejects.toThrow()
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.GMAIL)
    })

    it('throws non-401 errors without calling markInvalid', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'))

      await expect(service.getUnreadCount('user-1')).rejects.toThrow('Network error')
      expect(mockCredentials.markInvalid).not.toHaveBeenCalled()
    })
  })

  // ── refreshAccessToken ─────────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('returns new access token and stores credential on success', async () => {
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockCredentials.storeCredential.mockResolvedValueOnce(undefined)
      mockFetch(true, { access_token: 'new-tok', expires_in: 3600 })

      const token = await service.refreshAccessToken('user-1', 'old-refresh-tok')

      expect(token).toBe('new-tok')
      expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-tok',
          refreshToken: 'old-refresh-tok',
        }),
      )
    })

    it('marks credential INVALID and throws when refresh endpoint returns non-2xx', async () => {
      mockCredentials.markInvalid.mockResolvedValueOnce(undefined)
      mockFetch(false, 'invalid_client')

      await expect(service.refreshAccessToken('user-1', 'bad-refresh')).rejects.toThrow(
        'Gmail token refresh failed',
      )
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.GMAIL)
    })

    it('throws when Gmail client credentials are not configured', async () => {
      mockConfig.get.mockReturnValue(undefined as unknown as string)

      await expect(service.refreshAccessToken('user-1', 'rt')).rejects.toThrow(
        'Gmail client credentials not configured',
      )
    })
  })
})
