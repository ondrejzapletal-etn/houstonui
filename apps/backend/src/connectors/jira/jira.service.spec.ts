/**
 * JiraService – unit tests
 *
 * Tests cover:
 *  - getWorklogs: happy path, proactive token refresh, 401 → refresh → success,
 *    401 → refresh failure → markInvalid, missing cloudId/accountId throws
 *  - refreshAccessToken: success, HTTP failure → markInvalid, missing config throws
 *  - Worklog aggregation: entries are correctly grouped by day, only entries for
 *    the requested month are included, entries from other authors are excluded
 *  - addWorklog: success, ADF comment, 401 → refresh → success, API error throws
 *
 * No real HTTP calls – global fetch is mocked per test.
 * No Key Vault or DB – ConnectorCredentialsService is fully mocked.
 *
 * Fetch flow (JQL search + per-issue worklog):
 *   1. GET /search/jql?jql=worklogAuthor%3D...  → { issues: [{key}], total: N }
 *   2. GET /issue/{key}/worklog?startedAfter=...&startedBefore=... → { total, worklogs }
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
import { JiraService } from './jira.service'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { CredentialInvalidException } from '../connector-credential.errors'

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
      JIRA_CLIENT_ID: 'test-jira-client-id',
      JIRA_CLIENT_SECRET: 'test-jira-client-secret',
    }
    return map[key]
  }),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokens(
  overrides: Partial<{ accessToken: string; refreshToken: string; accountId: string }> = {},
) {
  return {
    accessToken: 'access-tok',
    refreshToken: 'refresh-tok',
    obtainedAt: new Date().toISOString(),
    accountId: 'atlassian-account-id',
    ...overrides,
  }
}

function makeMeta(
  overrides: Partial<{ tokenExpiresAt: Date | null; externalAccountId: string | null }> = {},
) {
  return {
    id: 'cred-1',
    userId: 'user-1',
    connectorType: ConnectorType.JIRA,
    status: 'ACTIVE' as const,
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    externalAccountId: 'cloud-abc123',
    tokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeIssueSearchPage(keys: string[]): object {
  return {
    issues: keys.map((key) => ({ key, fields: { summary: `Summary of ${key}` } })),
    total: keys.length,
  }
}

function makeWorklogPage(
  worklogs: object[],
  total?: number,
): object {
  return { total: total ?? worklogs.length, worklogs }
}

function makeWorklogEntry(opts: {
  accountId: string
  started: string
  timeSpentSeconds: number
}): object {
  return {
    id: String(Math.random()),
    author: { accountId: opts.accountId },
    started: opts.started,
    timeSpentSeconds: opts.timeSpentSeconds,
  }
}

function mockFetchOk(body: object): void {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

function mockFetchStatus(status: number): void {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => `HTTP ${status}`,
  } as unknown as Response)
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('JiraService', () => {
  let service: JiraService

  beforeEach(async () => {
    jest.clearAllMocks()
    global.fetch = jest.fn()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraService,
        { provide: ConnectorCredentialsService, useValue: mockCredentials },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get<JiraService>(JiraService)
  })

  // ── getWorklogs: happy path ────────────────────────────────────────────────

  describe('getWorklogs', () => {
    it('aggregates worklog seconds per day', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      // JQL search → 1 issue
      mockFetchOk(makeIssueSearchPage(['PROJ-1']))
      // worklog list for PROJ-1
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-03T09:00:00.000+0000', timeSpentSeconds: 3600 }),
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-03T14:00:00.000+0000', timeSpentSeconds: 1800 }),
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-07T09:00:00.000+0000', timeSpentSeconds: 7200 }),
        ]),
      )

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay[3]).toBe(5400) // 3600 + 1800
      expect(result.secondsPerDay[7]).toBe(7200)
      expect(result.cloudId).toBe('cloud-abc123')
      expect(result.accountId).toBe('atlassian-account-id')
    })

    it('excludes entries from other authors', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk(makeIssueSearchPage(['PROJ-1']))
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'other-author', started: '2026-05-05T09:00:00.000+0000', timeSpentSeconds: 3600 }),
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-05T10:00:00.000+0000', timeSpentSeconds: 1800 }),
        ]),
      )

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay[5]).toBe(1800)
    })

    it('excludes entries outside the requested month', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk(makeIssueSearchPage(['PROJ-1']))
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-04-30T23:00:00.000+0000', timeSpentSeconds: 3600 }),
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-01T00:30:00.000+0000', timeSpentSeconds: 900 }),
        ]),
      )

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay[30]).toBeUndefined()
      expect(result.secondsPerDay[1]).toBe(900)
    })

    it('returns empty map when no issues match JQL', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk(makeIssueSearchPage([]))

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay).toEqual({})
    })

    it('throws CredentialInvalidException when cloudId is missing', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta({ externalAccountId: null }))
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      await expect(service.getWorklogs('user-1', 2026, 5)).rejects.toThrow(CredentialInvalidException)
    })

    it('throws CredentialInvalidException when accountId is missing', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens({ accountId: undefined }))

      await expect(service.getWorklogs('user-1', 2026, 5)).rejects.toThrow(CredentialInvalidException)
    })
  })

  describe('getAllWorklogStats', () => {
    it('counts and sums all worklogs belonging to the authenticated Jira user', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk(makeIssueSearchPage(['PROJ-1', 'PROJ-2']))
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-03T09:00:00.000+0000', timeSpentSeconds: 3600 }),
          makeWorklogEntry({ accountId: 'other-author', started: '2026-05-04T09:00:00.000+0000', timeSpentSeconds: 7200 }),
        ]),
      )
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-05T09:00:00.000+0000', timeSpentSeconds: 1800 }),
        ]),
      )

      await expect(service.getAllWorklogStats('user-1')).resolves.toEqual({ count: 2, seconds: 5400 })
    })
  })

  describe('getWorklogIssuesForMonth', () => {
    it('aggregates monthly seconds by issue key', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      // JQL search -> 2 issues
      mockFetchOk(makeIssueSearchPage(['PROJ-1', 'PROJ-2']))
      // Worklogs for PROJ-1
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-03T09:00:00.000+0000', timeSpentSeconds: 3600 }),
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-03T12:00:00.000+0000', timeSpentSeconds: 900 }),
        ]),
      )
      // Worklogs for PROJ-2
      mockFetchOk(
        makeWorklogPage([
          makeWorklogEntry({ accountId: 'atlassian-account-id', started: '2026-05-07T09:00:00.000+0000', timeSpentSeconds: 7200 }),
        ]),
      )

      const result = await service.getWorklogIssuesForMonth('user-1', 2026, 5)

      expect(result).toEqual([
        { issueId: 'PROJ-2', issueName: 'Summary of PROJ-2', totalSeconds: 7200 },
        { issueId: 'PROJ-1', issueName: 'Summary of PROJ-1', totalSeconds: 4500 },
      ])
    })
  })

  describe('getWorklogEntriesForIssueInMonth', () => {
    it('vrátí detailní entries pro konkrétní issue v měsíci', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk(
        makeWorklogPage([
          {
            id: 'wl-1',
            author: { accountId: 'atlassian-account-id' },
            started: '2026-05-08T09:00:00.000+0000',
            timeSpentSeconds: 1800,
            comment: {
              type: 'doc',
              version: 1,
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Code review' }] },
              ],
            },
          },
          {
            id: 'wl-2',
            author: { accountId: 'atlassian-account-id' },
            started: '2026-05-09T10:00:00.000+0000',
            timeSpentSeconds: 3600,
            comment: 'Implementace',
          },
          {
            id: 'wl-3',
            author: { accountId: 'other-author' },
            started: '2026-05-10T10:00:00.000+0000',
            timeSpentSeconds: 1200,
          },
        ]),
      )

      const result = await service.getWorklogEntriesForIssueInMonth('user-1', 2026, 5, 'PROJ-55')

      expect(result).toEqual([
        {
          id: 'wl-1',
          issueId: 'PROJ-55',
          started: '2026-05-08T09:00:00.000+0000',
          timeSpentSeconds: 1800,
          comment: 'Code review',
        },
        {
          id: 'wl-2',
          issueId: 'PROJ-55',
          started: '2026-05-09T10:00:00.000+0000',
          timeSpentSeconds: 3600,
          comment: 'Implementace',
        },
      ])
    })
  })

  // ── getWorklogs: token refresh ─────────────────────────────────────────────

  describe('getWorklogs – token refresh', () => {
    it('proactively refreshes token when near expiry', async () => {
      const soonExpiry = new Date(Date.now() + 2 * 60 * 1000)
      mockCredentials.getMetadata.mockResolvedValue(makeMeta({ tokenExpiresAt: soonExpiry }))
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockCredentials.storeCredential.mockResolvedValue(undefined)

      mockFetchOk({ access_token: 'new-tok', expires_in: 3600 })
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockFetchOk(makeIssueSearchPage([]))

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay).toEqual({})
      expect(mockCredentials.storeCredential).toHaveBeenCalled()
    })

    it('retries on 401 after refreshing token', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockCredentials.storeCredential.mockResolvedValue(undefined)

      mockFetchStatus(401)
      mockFetchOk({ access_token: 'new-tok', expires_in: 3600 })
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockFetchOk(makeIssueSearchPage([]))

      const result = await service.getWorklogs('user-1', 2026, 5)

      expect(result.secondsPerDay).toEqual({})
    })

    it('marks credential invalid when refresh fails after 401', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockCredentials.markInvalid.mockResolvedValue(undefined)

      mockFetchStatus(401)
      mockFetchStatus(400)

      await expect(service.getWorklogs('user-1', 2026, 5)).rejects.toThrow()
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.JIRA)
    })
  })

  // ── addWorklog ─────────────────────────────────────────────────────────────

  describe('addWorklog', () => {
    it('posts worklog and returns worklogId', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk({ id: 'worklog-999', started: '2026-05-11T12:00:00.000+0000', timeSpentSeconds: 3600 })

      const result = await service.addWorklog('user-1', 'PROJ-123', '2026-05-11', 3600, 'Done')

      expect(result.worklogId).toBe('worklog-999')
      expect(result.timeSpentSeconds).toBe(3600)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/issue/PROJ-123/worklog'),
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('sends comment in ADF format when provided', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockFetchOk({ id: 'wl-1', started: '2026-05-11T12:00:00.000+0000', timeSpentSeconds: 1800 })

      await service.addWorklog('user-1', 'PROJ-1', '2026-05-11', 1800, 'My comment')

      const call = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>
      expect(body['comment']).toMatchObject({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My comment' }] }],
      })
    })

    it('omits comment field when not provided', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockFetchOk({ id: 'wl-1', started: '2026-05-11T12:00:00.000+0000', timeSpentSeconds: 1800 })

      await service.addWorklog('user-1', 'PROJ-1', '2026-05-11', 1800)

      const call = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>
      expect(body['comment']).toBeUndefined()
    })

    it('retries on 401 after token refresh', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockCredentials.storeCredential.mockResolvedValue(undefined)

      mockFetchStatus(401)
      mockFetchOk({ access_token: 'new-tok', expires_in: 3600 })
      mockCredentials.getTokens.mockResolvedValueOnce(makeTokens())
      mockFetchOk({ id: 'wl-1', started: '2026-05-11T12:00:00.000+0000', timeSpentSeconds: 3600 })

      const result = await service.addWorklog('user-1', 'PROJ-1', '2026-05-11', 3600)

      expect(result.worklogId).toBe('wl-1')
    })

    it('throws when addWorklog API returns non-2xx', async () => {
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchStatus(400)

      await expect(service.addWorklog('user-1', 'PROJ-1', '2026-05-11', 3600)).rejects.toThrow(
        'Jira addWorklog error 400',
      )
    })
  })

  // ── refreshAccessToken ─────────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('stores new access token on success', async () => {
      mockCredentials.storeCredential.mockResolvedValue(undefined)
      mockCredentials.getTokens.mockResolvedValue(makeTokens())

      mockFetchOk({ access_token: 'fresh-tok', refresh_token: 'new-refresh', expires_in: 3600 })

      const newToken = await service.refreshAccessToken('user-1', 'old-refresh')

      expect(newToken).toBe('fresh-tok')
      expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'fresh-tok', refreshToken: 'new-refresh' }),
      )
    })

    it('preserves cloudId and accountId across a refresh', async () => {
      mockCredentials.storeCredential.mockResolvedValue(undefined)
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockCredentials.getMetadata.mockResolvedValue(makeMeta())

      mockFetchOk({ access_token: 'fresh-tok', refresh_token: 'new-refresh', expires_in: 3600 })

      await service.refreshAccessToken('user-1', 'old-refresh')

      expect(mockCredentials.storeCredential).toHaveBeenCalledWith(
        expect.objectContaining({
          externalAccountId: 'cloud-abc123',
          accountId: 'atlassian-account-id',
        }),
      )
    })

    it('shares a concurrent refresh so a rotated refresh token is used only once', async () => {
      mockCredentials.storeCredential.mockResolvedValue(undefined)
      mockCredentials.getTokens.mockResolvedValue(makeTokens())
      mockFetchOk({ access_token: 'fresh-tok', refresh_token: 'new-refresh', expires_in: 3600 })

      const [firstToken, secondToken] = await Promise.all([
        service.refreshAccessToken('user-1', 'refresh-tok', 'access-tok'),
        service.refreshAccessToken('user-1', 'refresh-tok', 'access-tok'),
      ])

      expect(firstToken).toBe('fresh-tok')
      expect(secondToken).toBe('fresh-tok')
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(mockCredentials.storeCredential).toHaveBeenCalledTimes(1)
    })

    it('marks credential invalid and throws on HTTP failure', async () => {
      mockCredentials.markInvalid.mockResolvedValue(undefined)

      mockFetchStatus(400)

      await expect(service.refreshAccessToken('user-1', 'refresh-tok')).rejects.toThrow()
      expect(mockCredentials.markInvalid).toHaveBeenCalledWith('user-1', ConnectorType.JIRA)
    })

    it('throws when client config is missing', async () => {
      mockCredentials.markInvalid.mockResolvedValue(undefined)
      mockConfig.get.mockReturnValue(null as unknown as string)

      await expect(service.refreshAccessToken('user-1', 'refresh-tok')).rejects.toThrow(
        'JIRA_CLIENT_ID',
      )
    })
  })
})
