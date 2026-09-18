/**
 * SlackService – unit tests
 *
 * Tests cover:
 *  - getUnreadCount: happy path (DMs + channels), proactive token refresh,
 *    auth error → refresh → success, auth error without refresh token → markInvalid,
 *    non-auth errors propagate
 *  - fetchConversationUnreadSum: pagination (cursor), non-auth Slack errors return 0
 *  - refreshAccessToken: success, Slack API ok=false, HTTP failure → markInvalid
 *
 * No real HTTP calls – global fetch is mocked per test.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
import { SlackService } from './slack.service'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { PrismaService } from '../../prisma/prisma.service'

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
      SLACK_CLIENT_ID: 'slack-client-id',
      SLACK_CLIENT_SECRET: 'slack-client-secret',
    }
    return map[key]
  }),
}

const mockPrisma = {
  slackReadCursor: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}

let accessTokenSequence = 0

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokens(overrides: Partial<{ accessToken: string; refreshToken: string | null }> = {}) {
  return {
    accessToken: `xoxp-access-token-${accessTokenSequence++}`,
    refreshToken: null,
    ...overrides,
  }
}

function makeMeta(
  overrides: Partial<{ tokenExpiresAt: Date | null; externalAccountId: string }> = {},
) {
  return {
    id: 'cred-1',
    userId: 'user-1',
    connectorType: ConnectorType.SLACK,
    status: 'ACTIVE',
    scopes: ['im:read', 'channels:read'],
    externalAccountId: 'U12345',
    tokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeSlackListResponse(
  channels: Array<{ unread_count_display?: number }>,
  nextCursor?: string,
) {
  return {
    ok: true,
    channels: channels.map((c, i) => ({ id: `C${i}`, ...c })),
    response_metadata: nextCursor ? { next_cursor: nextCursor } : { next_cursor: '' },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SlackService', () => {
  let service: SlackService

  beforeEach(async () => {
    jest.clearAllMocks()
    SlackService.clearCacheForTests()
    mockPrisma.slackReadCursor.findMany.mockResolvedValue([])
    mockPrisma.slackReadCursor.findUnique.mockResolvedValue(null)
    mockPrisma.slackReadCursor.upsert.mockResolvedValue({})

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackService,
        { provide: ConnectorCredentialsService, useValue: mockCredentials },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get(SlackService)
  })

  describe('scan message filtering', () => {
    type FetchedChannel = {
      channelId: string
      channelName: string
      isDmOrMpim: boolean
      isDirectMessage: boolean
      messages: Array<{
        channelId: string
        channelName: string
        ts: string
        userId: string
        userName: string
        text: string
        replyUserIds: string[]
      }>
    }

    const message = (
      channelId: string,
      ts: string,
      userId: string,
      replyUserIds: string[] = [],
    ): FetchedChannel['messages'][number] => ({
      channelId,
      channelName: channelId,
      ts,
      userId,
      userName: userId,
      text: `${userId} at ${ts}`,
      replyUserIds,
    })

    const filter = (channels: FetchedChannel[], externalAccountId?: string) => {
      const scanService = service as unknown as {
        filterAnsweredMessages: (
          channels: FetchedChannel[],
          externalAccountId?: string,
        ) => { channels: FetchedChannel[]; answeredMessages: Array<{ channelId: string; ts: string }> }
      }
      return scanService.filterAnsweredMessages(channels, externalAccountId)
    }

    const excludeOwn = (channels: FetchedChannel[], externalAccountId?: string) => {
      const previewService = service as unknown as {
        excludeOwnMessages: (
          channels: FetchedChannel[],
          externalAccountId?: string,
        ) => FetchedChannel[]
      }
      return previewService.excludeOwnMessages(channels, externalAccountId)
    }

    it('excludes own messages from preview while retaining answered incoming messages', () => {
      const answeredIncoming = message('C1', '100.000001', 'U99999', ['U12345'])
      const result = excludeOwn([{
        channelId: 'C1',
        channelName: 'one',
        isDmOrMpim: false,
        isDirectMessage: false,
        messages: [message('C1', '100.000002', 'U12345'), answeredIncoming],
      }], 'U12345')

      expect(result[0].messages).toEqual([answeredIncoming])
    })

    it('excludes own messages and channels containing no remaining messages', () => {
      const channels: FetchedChannel[] = [
        {
          channelId: 'C1',
          channelName: 'one',
          isDmOrMpim: false,
          isDirectMessage: false,
          messages: [
            message('C1', '100.000001', 'U12345'),
            message('C1', '100.000002', 'U99999'),
          ],
        },
        {
          channelId: 'C2',
          channelName: 'two',
          isDmOrMpim: false,
          isDirectMessage: false,
          messages: [message('C2', '100.000003', 'U12345')],
        },
      ]

      const result = filter(channels, 'U12345')

      expect(result.channels).toHaveLength(1)
      expect(result.channels[0].messages).toEqual([message('C1', '100.000002', 'U99999')])
      expect(result.answeredMessages).toEqual([])
    })

    it('excludes a thread root when the connected user is among its reply users', () => {
      const channels: FetchedChannel[] = [{
        channelId: 'C1',
        channelName: 'one',
        isDmOrMpim: false,
        isDirectMessage: false,
        messages: [
          message('C1', '100.000001', 'U99999', ['UOTHER', 'U12345']),
          message('C1', '100.000002', 'U99999', ['UOTHER']),
        ],
      }]

      const result = filter(channels, 'U12345')

      expect(result.channels[0].messages).toEqual([message('C1', '100.000002', 'U99999', ['UOTHER'])])
      expect(result.answeredMessages).toEqual([{ channelId: 'C1', ts: '100.000001' }])
    })

    it('keeps only incoming DM messages newer than the latest own reply', () => {
      const channels: FetchedChannel[] = [{
        channelId: 'D1',
        channelName: 'direct',
        isDmOrMpim: true,
        isDirectMessage: true,
        messages: [
          message('D1', '100.000003', 'U99999'),
          message('D1', '100.000002', 'U12345'),
          message('D1', '100.000001', 'U99999'),
        ],
      }]

      const result = filter(channels, 'U12345')

      expect(result.channels[0].messages).toEqual([message('D1', '100.000003', 'U99999')])
      expect(result.answeredMessages).toEqual([{ channelId: 'D1', ts: '100.000001' }])
    })

    it('does not infer replies from later own messages in channels or MPIMs', () => {
      const channels: FetchedChannel[] = [
        {
          channelId: 'C1',
          channelName: 'channel',
          isDmOrMpim: false,
          isDirectMessage: false,
          messages: [message('C1', '100.000002', 'U12345'), message('C1', '100.000001', 'U99999')],
        },
        {
          channelId: 'G1',
          channelName: 'group',
          isDmOrMpim: true,
          isDirectMessage: false,
          messages: [message('G1', '100.000002', 'U12345'), message('G1', '100.000001', 'U99999')],
        },
      ]

      const result = filter(channels, 'U12345')

      expect(result.channels.flatMap((channel) => channel.messages.map((item) => item.ts))).toEqual([
        '100.000001',
        '100.000001',
      ])
      expect(result.answeredMessages).toEqual([])
    })

    it('keeps messages when the connected account identity is unavailable', () => {
      const channels: FetchedChannel[] = [{
        channelId: 'C1',
        channelName: 'one',
        isDmOrMpim: false,
        isDirectMessage: false,
        messages: [message('C1', '100.000001', 'U12345')],
      }]

      expect(filter(channels)).toEqual({ channels, answeredMessages: [] })
    })

    it('preserves reply user IDs returned by conversations.history', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '100.000001',
              user: 'U99999',
              text: 'Please reply',
              reply_users: ['U12345'],
            }],
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Colleague' } } }),
        } as Response)
      const scanService = service as unknown as {
        fetchChannelMessages: (
          accessToken: string,
          channelId: string,
          channelName: string,
        ) => Promise<{ messages: Array<{ replyUserIds: string[] }> }>
      }

      const result = await scanService.fetchChannelMessages('token', 'C1', 'channel')

      expect(result.messages[0].replyUserIds).toEqual(['U12345'])
    })
  })

  describe('scan cache', () => {
    it('invalidates the cached scan after successfully sending a thread reply', async () => {
      mockCredentials.getTokens.mockResolvedValue(makeTokens({ accessToken: 'cache-invalidation-token' }))
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        } as Response)

      await service.fetchScanMessages('cache-user')
      await service.fetchScanMessages('cache-user')
      await service.sendThreadReply('cache-user', {
        channelId: 'C1',
        threadTs: '100.000001',
        text: 'Done',
      })
      await service.fetchScanMessages('cache-user')

      expect(mockCredentials.getTokens).toHaveBeenCalledTimes(3)
      expect(mockCredentials.getMetadata).toHaveBeenCalledTimes(3)
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('preview read state', () => {
    it('includes a Slack Connect DM when conversations.list reports unread messages', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ accessToken: 'external-dm-token' }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            channels: [{
              id: 'D_EXTERNAL',
              user: 'U_EXTERNAL',
              is_im: true,
              is_ext_shared: true,
              unread_count: 1,
              last_read: '100.000000',
            }],
            response_metadata: { next_cursor: '' },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            user: { profile: { display_name: 'External client' } },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              ts: '200.000000',
              user: 'U_EXTERNAL',
              text: 'Please send me the revised proposal today.',
            }],
          }),
        } as Response)

      const result = await service.fetchScanMessages('external-dm-user', false, true)

      expect(result.channels).toEqual([
        expect.objectContaining({
          channelId: 'D_EXTERNAL',
          channelName: 'External client',
          conversationType: 'dm',
          messages: [expect.objectContaining({
            text: 'Please send me the revised proposal today.',
            mentionsCurrentUser: false,
          })],
        }),
      ])
      expect(global.fetch).toHaveBeenCalledTimes(4)
    })

    it('treats an explicit zero unread count as read when last_read is unavailable', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ accessToken: 'preview-read-token' }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            channels: [{
              id: 'C1',
              name: 'read-channel',
              is_member: true,
              unread_count: 0,
            }],
            response_metadata: { next_cursor: '' },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{ ts: '100.000000', user: 'U99999', text: 'Already read' }],
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Colleague' } } }),
        } as Response)

      const result = await service.fetchScanMessages('preview-user', true, true)

      expect(result.channels).toHaveLength(1)
      expect(result.channels[0].messages[0]).toEqual(expect.objectContaining({
        text: 'Already read',
        isUnread: false,
      }))
    })

    it('uses the persisted Houston read cursor when Slack still reports unread', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ accessToken: 'cursor-token' }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockPrisma.slackReadCursor.findMany.mockResolvedValueOnce([
        { channelId: 'C1', timestamp: '200.000000' },
      ])
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([]),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            channels: [{ id: 'C1', name: 'channel', is_member: true, unread_count: 1 }],
            response_metadata: { next_cursor: '' },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{ ts: '100.000000', user: 'U99999', text: 'Read in Houston' }],
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, user: { profile: { display_name: 'Colleague' } } }),
        } as Response)

      const result = await service.fetchScanMessages('preview-user', true)

      expect(result.channels[0].messages[0].isUnread).toBe(false)
    })
  })

  describe('markMessageAsRead', () => {
    it('persists the confirmed Slack timestamp as a read cursor', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ accessToken: 'mark-token' }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response)

      await service.markMessageAsRead('user-1', 'C1', '200.000000')

      expect(mockPrisma.slackReadCursor.upsert).toHaveBeenCalledWith({
        where: { userId_channelId: { userId: 'user-1', channelId: 'C1' } },
        create: { userId: 'user-1', channelId: 'C1', timestamp: '200.000000' },
        update: { timestamp: '200.000000' },
      })
    })
  })

  describe('rate limiting', () => {
    it('returns stale conversation data when Slack remains rate-limited after retry', async () => {
      const listConversations = (service as unknown as {
        listConversations: (accessToken: string, types: string) => Promise<Array<{ id: string }>>
      }).listConversations.bind(service)
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          channels: [{ id: 'C1' }],
          response_metadata: { next_cursor: '' },
        }),
      } as Response)
      const cached = await listConversations('rate-limit-token', 'public_channel')
      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now + 3 * 60_000)
      const rateLimitedResponse = {
        ok: false,
        status: 429,
        headers: { get: () => '0' },
      } as unknown as Response
      global.fetch = jest.fn().mockResolvedValue(rateLimitedResponse)

      try {
        await expect(listConversations('rate-limit-token', 'public_channel')).resolves.toEqual(cached)
      } finally {
        dateSpy.mockRestore()
      }
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns summed DM + channel unread counts', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      global.fetch = jest
        .fn()
        // DMs: im + mpim
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () =>
            makeSlackListResponse([{ unread_count_display: 3 }, { unread_count_display: 2 }]),
          text: async () => '',
        } as Response)
        // Channels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 10 }]),
          text: async () => '',
        } as Response)

      const result = await service.getUnreadCount('user-1')

      expect(result.dms).toBe(5)
      expect(result.channels).toBe(10)
      expect(result.total).toBe(15)
      expect(result.externalAccountId).toBe('U12345')
    })

    it('returns zero counts when no unread conversations exist', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeSlackListResponse([]),
        text: async () => '',
      } as Response)

      const result = await service.getUnreadCount('user-1')

      expect(result.total).toBe(0)
    })

    it('counts every unread message instead of only conversations with unread activity', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ accessToken: 'message-count-token' }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 3 }, { unread_count_display: 2 }]),
          text: async () => '',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 4 }]),
          text: async () => '',
        } as Response)

      const result = await service.getUnreadCount('user-1')

      expect(result).toMatchObject({ dms: 5, channels: 4, total: 9 })
    })

    it('handles pagination via cursor when fetching conversations', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      // Fetch call order: DMs-page1, DMs-page2, then channels-page1.
      global.fetch = jest
        .fn()
        // DMs page 1 → has cursor (triggers page 2)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () =>
            makeSlackListResponse([{ unread_count_display: 5 }], 'next-page-cursor'),
          text: async () => '',
        } as Response)
        // DMs page 2 → no cursor
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 3 }]),
          text: async () => '',
        } as Response)
        // Channels page 1 → no cursor
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 0 }]),
          text: async () => '',
        } as Response)

      const result = await service.getUnreadCount('user-1')

      expect(result.dms).toBe(8)
      // fetch called 3 times: DMs page1, channels page1, DMs page2
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('fails instead of saving an incomplete count when Slack rejects a required scope', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())

      global.fetch = jest
        .fn()
        // DMs: missing_scope (non-auth error)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, error: 'missing_scope' }),
          text: async () => '',
        } as Response)
        // Channels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 4 }]),
          text: async () => '',
        } as Response)

      await expect(service.getUnreadCount('user-1')).rejects.toThrow('missing_scope')
    })

    it('marks credential INVALID on invalid_auth when no refresh token available', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ refreshToken: null }))
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockCredentials.markInvalid.mockResolvedValueOnce(undefined)

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
        text: async () => '',
      } as Response)

      await expect(service.getUnreadCount('user-1')).rejects.toThrow()
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.SLACK)
    })

    it('retries with refreshed token on auth error when refresh token is present', async () => {
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens({ refreshToken: 'rt' }))
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

      global.fetch = jest
        .fn()
        // DMs → token_revoked (triggers refresh)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, error: 'token_revoked' }),
          text: async () => '',
        } as Response)
        // Token refresh endpoint
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, access_token: 'new-xoxp', expires_in: 3600 }),
          text: async () => '',
        } as Response)
        // Retry DMs
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 2 }]),
          text: async () => '',
        } as Response)
        // Retry channels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeSlackListResponse([{ unread_count_display: 1 }]),
          text: async () => '',
        } as Response)

      const result = await service.getUnreadCount('user-1')

      expect(result.total).toBe(3)
    })
  })

  // ── refreshAccessToken ─────────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('returns new access token and updates stored credential', async () => {
      mockCredentials.getMetadata.mockResolvedValueOnce(makeMeta())
      mockCredentials.storeCredential.mockResolvedValueOnce(undefined)

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          access_token: 'new-xoxp',
          refresh_token: 'new-rt',
          expires_in: 3600,
        }),
        text: async () => '',
      } as Response)

      const token = await service.refreshAccessToken('user-1', 'old-rt')

      expect(token).toBe('new-xoxp')
      expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-xoxp',
          refreshToken: 'new-rt',
        }),
      )
    })

    it('marks credential INVALID and throws when Slack returns ok=false', async () => {
      mockCredentials.markInvalid.mockResolvedValueOnce(undefined)

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
        text: async () => '',
      } as Response)

      await expect(service.refreshAccessToken('user-1', 'bad-rt')).rejects.toThrow(
        'Slack token refresh error',
      )
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.SLACK)
    })

    it('marks credential INVALID and throws on HTTP failure', async () => {
      mockCredentials.markInvalid.mockResolvedValueOnce(undefined)

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'server error',
      } as Response)

      await expect(service.refreshAccessToken('user-1', 'rt')).rejects.toThrow(
        'Slack token refresh failed',
      )
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.SLACK)
    })

    it('throws when Slack client credentials are not configured', async () => {
      mockConfig.get.mockReturnValue(undefined as unknown as string)

      await expect(service.refreshAccessToken('user-1', 'rt')).rejects.toThrow(
        'Slack client credentials not configured',
      )
    })
  })
})
