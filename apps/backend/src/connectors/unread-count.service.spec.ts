/**
 * UnreadCountService – unit tests
 *
 * Tests cover:
 *  - onModuleInit / onModuleDestroy: timer is created and cleared
 *  - fetchForUser: success caches count + audits, error returns null + audits failure
 *  - fetchAllForUser: queries ACTIVE credentials and calls fetchForUser for each
 *  - getCached: returns DB-cached values without live fetch
 *  - Error isolation: one failing connector does not block others
 *
 * PrismaService, GmailService, SlackService, AuditService are fully mocked.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConnectorType } from '@prisma/client'
import { UnreadCountService } from './unread-count.service'
import { PrismaService } from '../prisma/prisma.service'
import { GmailService } from './gmail/gmail.service'
import { SlackService } from './slack/slack.service'
import { AuditService } from '../audit/audit.service'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  connectorCredential: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
}

const mockGmail = {
  getUnreadCount: jest.fn(),
}

const mockSlack = {
  getUnreadCount: jest.fn(),
}

const mockAudit = {
  log: jest.fn(),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UnreadCountService', () => {
  let service: UnreadCountService

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnreadCountService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GmailService, useValue: mockGmail },
        { provide: SlackService, useValue: mockSlack },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile()

    service = module.get(UnreadCountService)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts periodic timer on module init', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval')
      service.onModuleInit()
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000)
    })

    it('clears timer on module destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval')
      service.onModuleInit()
      service.onModuleDestroy()
      expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it('does not throw on destroy when init was never called', () => {
      expect(() => service.onModuleDestroy()).not.toThrow()
    })
  })

  // ── fetchForUser ───────────────────────────────────────────────────────────

  describe('fetchForUser', () => {
    it('returns unread count and caches it on success (Gmail)', async () => {
      mockGmail.getUnreadCount.mockResolvedValueOnce({ unreadCount: 12 })
      mockPrisma.connectorCredential.updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.fetchForUser('user-1', ConnectorType.GMAIL)

      expect(result.type).toBe(ConnectorType.GMAIL)
      expect(result.unreadCount).toBe(12)
      expect(result.fetchedAt).toBeInstanceOf(Date)
      expect(result.error).toBeUndefined()

      expect(mockPrisma.connectorCredential.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', connectorType: ConnectorType.GMAIL },
          data: expect.objectContaining({ unreadCount: 12 }),
        }),
      )
    })

    it('returns unread count and caches it on success (Slack)', async () => {
      mockSlack.getUnreadCount.mockResolvedValueOnce({ total: 7 })
      mockPrisma.connectorCredential.updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.fetchForUser('user-1', ConnectorType.SLACK)

      expect(result.unreadCount).toBe(7)
    })

    it('audits success with outcome=success', async () => {
      mockGmail.getUnreadCount.mockResolvedValueOnce({ unreadCount: 3 })
      mockPrisma.connectorCredential.updateMany.mockResolvedValueOnce({ count: 1 })

      await service.fetchForUser('user-1', ConnectorType.GMAIL)

      expect(mockAudit.log).toHaveBeenCalledWith(
        'connector.unread.fetched',
        expect.objectContaining({
          userId: 'user-1',
          connectorType: ConnectorType.GMAIL,
          metadata: expect.objectContaining({ outcome: 'success', unreadCount: 3 }),
        }),
      )
    })

    it('returns null count and error message when fetch fails', async () => {
      mockGmail.getUnreadCount.mockRejectedValueOnce(new Error('API unavailable'))

      const result = await service.fetchForUser('user-1', ConnectorType.GMAIL)

      expect(result.unreadCount).toBeNull()
      expect(result.fetchedAt).toBeNull()
      expect(result.error).toBe('API unavailable')
    })

    it('audits failure with outcome=failure when fetch throws', async () => {
      mockGmail.getUnreadCount.mockRejectedValueOnce(new Error('token expired'))

      await service.fetchForUser('user-1', ConnectorType.GMAIL)

      expect(mockAudit.log).toHaveBeenCalledWith(
        'connector.unread.fetch_failed',
        expect.objectContaining({
          userId: 'user-1',
          metadata: expect.objectContaining({ outcome: 'failure', errorMessage: 'token expired' }),
        }),
      )
    })

    it('does NOT call cacheCount when fetch fails', async () => {
      mockGmail.getUnreadCount.mockRejectedValueOnce(new Error('fail'))

      await service.fetchForUser('user-1', ConnectorType.GMAIL)

      expect(mockPrisma.connectorCredential.updateMany).not.toHaveBeenCalled()
    })
  })

  // ── fetchAllForUser ────────────────────────────────────────────────────────

  describe('fetchAllForUser', () => {
    it('fetches for each ACTIVE credential of the user', async () => {
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce([
        { connectorType: ConnectorType.GMAIL },
        { connectorType: ConnectorType.SLACK },
      ])
      mockGmail.getUnreadCount.mockResolvedValueOnce({ unreadCount: 5 })
      mockSlack.getUnreadCount.mockResolvedValueOnce({ total: 2 })
      mockPrisma.connectorCredential.updateMany.mockResolvedValue({ count: 1 })

      const results = await service.fetchAllForUser('user-1')

      expect(results).toHaveLength(2)
      expect(results.find((r) => r.type === ConnectorType.GMAIL)?.unreadCount).toBe(5)
      expect(results.find((r) => r.type === ConnectorType.SLACK)?.unreadCount).toBe(2)
    })

    it('returns empty array when user has no ACTIVE credentials', async () => {
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce([])

      const results = await service.fetchAllForUser('user-1')

      expect(results).toHaveLength(0)
    })

    it('isolates errors – Gmail failure does not block Slack', async () => {
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce([
        { connectorType: ConnectorType.GMAIL },
        { connectorType: ConnectorType.SLACK },
      ])
      mockGmail.getUnreadCount.mockRejectedValueOnce(new Error('Gmail down'))
      mockSlack.getUnreadCount.mockResolvedValueOnce({ total: 3 })
      mockPrisma.connectorCredential.updateMany.mockResolvedValue({ count: 1 })

      const results = await service.fetchAllForUser('user-1')

      const gmailResult = results.find((r) => r.type === ConnectorType.GMAIL)
      const slackResult = results.find((r) => r.type === ConnectorType.SLACK)

      expect(gmailResult?.unreadCount).toBeNull()
      expect(gmailResult?.error).toBe('Gmail down')
      expect(slackResult?.unreadCount).toBe(3)
    })
  })

  // ── getCached ──────────────────────────────────────────────────────────────

  describe('getCached', () => {
    it('returns DB-cached counts without making live API calls', async () => {
      const now = new Date()
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce([
        {
          connectorType: ConnectorType.GMAIL,
          unreadCount: 8,
          unreadCountFetchedAt: now,
          status: 'ACTIVE',
        },
        {
          connectorType: ConnectorType.SLACK,
          unreadCount: null,
          unreadCountFetchedAt: null,
          status: 'ACTIVE',
        },
      ])

      const results = await service.getCached('user-1')

      expect(results).toHaveLength(2)
      expect(results[0].unreadCount).toBe(8)
      expect(results[0].fetchedAt).toBe(now)
      expect(results[1].unreadCount).toBeNull()
      expect(results[1].fetchedAt).toBeNull()

      // Ensure no Gmail/Slack API calls were made
      expect(mockGmail.getUnreadCount).not.toHaveBeenCalled()
      expect(mockSlack.getUnreadCount).not.toHaveBeenCalled()
    })
  })
})
