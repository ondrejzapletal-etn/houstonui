/**
 * ConnectorsController – unit tests
 *
 * Testuje:
 *  - initiateConnect: s autentizovaným userem (předá user.id)
 *  - initiateConnect: bez usera vyhodí Unauthorized – v každém prostředí
 *  - handleCallback: úspěšný callback + log bez tokenů
 *  - handleCallback: chyba z provideru
 *  - handleCallback: chybějící code/state
 *  - handleCallback: výjimka ze service
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConnectorType } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { ConnectorsController } from './connectors.controller'
import { ConnectorsService } from './connectors.service'
import { UnreadCountService } from './unread-count.service'
import { JiraService } from './jira/jira.service'
import { ClockifyService } from './clockify/clockify.service'
import { HotSpotService } from './hotspot/hotspot.service'
import { UsersService } from '../users/users.service'
import { TimeSavedService } from '../users/time-saved.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { CalendarService } from './calendar/calendar.service'
import { GmailService } from './gmail/gmail.service'
import { SlackService } from './slack/slack.service'
import type { Request, Response } from 'express'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request
}

function makeResponse(): jest.Mocked<Pick<Response, 'status' | 'send'>> & {
  status: jest.Mock
  send: jest.Mock
} {
  const res = {
    status: jest.fn(),
    send: jest.fn(),
  }
  res.status.mockReturnValue(res)
  res.send.mockReturnValue(res)
  return res as unknown as jest.Mocked<Pick<Response, 'status' | 'send'>> & {
    status: jest.Mock
    send: jest.Mock
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockConnectorsService = {
  listConnectorsInfo: jest.fn(),
  initiateConnect: jest.fn(),
  handleCallback: jest.fn(),
  disconnect: jest.fn(),
}

const mockUnreadCountService = {
  fetchForUser: jest.fn(),
}

const mockJiraService = {
  getWorklogs: jest.fn(),
  getWorklogIssuesForMonth: jest.fn(),
  getWorklogEntriesForIssueInMonth: jest.fn(),
}

const mockClockifyService = {
  connectWithApiKey: jest.fn(),
  getWorklogs: jest.fn(),
  getWorklogIssuesForMonth: jest.fn(),
  getWorklogEntriesForIssueInMonth: jest.fn(),
}

const mockHotSpotService = {
  isInternalNetworkAvailable: jest.fn(),
}

const mockUsersService = {
  incrementWorklogs: jest.fn(),
}

const mockTimeSavedService = {
  record: jest.fn(),
}

const mockKnowledgeService = {
  resolveEntity: jest.fn(),
  appendEventInternal: jest.fn(),
  updateEntity: jest.fn(),
  upsertFactInternal: jest.fn(),
  createRelation: jest.fn(),
}

const mockCalendarService = {
  getEvent: jest.fn(),
  getEvents: jest.fn(),
}

const mockGmailService = {
  fetchSentEmailsForDay: jest.fn(),
}

const mockSlackService = {
  fetchSentMessagesForDay: jest.fn(),
}

let mockNodeEnv = 'development'

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'NODE_ENV') return mockNodeEnv
    return undefined
  }),
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ConnectorsController', () => {
  let controller: ConnectorsController

  beforeEach(async () => {
    jest.clearAllMocks()
    mockNodeEnv = 'development'

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: UnreadCountService, useValue: mockUnreadCountService },
        { provide: JiraService, useValue: mockJiraService },
        { provide: ClockifyService, useValue: mockClockifyService },
        { provide: HotSpotService, useValue: mockHotSpotService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: TimeSavedService, useValue: mockTimeSavedService },
        { provide: KnowledgeService, useValue: mockKnowledgeService },
        { provide: CalendarService, useValue: mockCalendarService },
        { provide: GmailService, useValue: mockGmailService },
        { provide: SlackService, useValue: mockSlackService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile()

    controller = module.get(ConnectorsController)
  })

  describe('listConnectors', () => {
    it('returns a VPN warning when the connected HOT SPOT service is unreachable', async () => {
      mockConnectorsService.listConnectorsInfo.mockResolvedValue({
        connectors: [{
          id: 'hotspot',
          label: 'Hot Spot',
          status: 'connected',
          unreadCount: null,
          lastCheckedAt: null,
        }],
      })
      mockHotSpotService.isInternalNetworkAvailable.mockResolvedValue(false)

      const result = await controller.listConnectors({ id: 'user-1' } as never)

      expect(mockHotSpotService.isInternalNetworkAvailable).toHaveBeenCalledWith('user-1')
      expect(result.data.connectors[0]).toMatchObject({
        status: 'warning',
        errorMessage: 'Interní síť není dostupná, připoj se na VPN',
      })
    })
  })

  describe('refreshUnread', () => {
    it('forces a refresh and returns the complete connector card response', async () => {
      mockUnreadCountService.fetchForUser.mockResolvedValue({
        type: ConnectorType.SLACK,
        unreadCount: 9,
        fetchedAt: new Date(),
      })
      mockConnectorsService.listConnectorsInfo.mockResolvedValue({
        connectors: [{
          id: 'slack',
          label: 'Slack',
          status: 'connected',
          unreadCount: 9,
          lastCheckedAt: '2026-08-19T12:40:00.000Z',
        }],
      })

      const result = await controller.refreshUnread({ id: 'user-1' } as never, ConnectorType.SLACK)

      expect(mockUnreadCountService.fetchForUser).toHaveBeenCalledWith(
        'user-1',
        ConnectorType.SLACK,
        true,
      )
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ id: 'slack', unreadCount: 9 }),
      })
    })
  })

  // ── initiateConnect ─────────────────────────────────────────────────────────

  describe('initiateConnect', () => {
    it('použije user.id z JWT pokud je přihlášen', async () => {
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?foo=bar'
      mockConnectorsService.initiateConnect.mockReturnValue({ authUrl })

      const result = await controller.initiateConnect(
        { id: 'user-123', email: 'test@example.com', entraId: 'entra-1' },
        ConnectorType.GMAIL,
        makeRequest(),
        {},
      )

      expect(mockConnectorsService.initiateConnect).toHaveBeenCalledWith(
        'user-123',
        ConnectorType.GMAIL,
        expect.anything(),
      )
      expect(result).toEqual({ authUrl })
    })

    // Unauthenticated-caller regressions live in connectors.controller.auth.spec.ts,
    // which compiles and runs today – this suite does not (see getWorklogsByIssue below).
  })

  // ── handleCallback ──────────────────────────────────────────────────────────

  describe('handleCallback', () => {
    it('úspěšný callback: zavolá handleCallback service a vrátí success HTML', async () => {
      mockConnectorsService.handleCallback.mockResolvedValue({
        userId: 'dev-user-placeholder',
        connectorType: ConnectorType.GMAIL,
      })

      const res = makeResponse()
      await controller.handleCallback(
        ConnectorType.GMAIL,
        'auth-code-abc',
        'state-xyz',
        undefined,
        makeRequest(),
        res as unknown as Response,
      )

      expect(mockConnectorsService.handleCallback).toHaveBeenCalledWith(
        'auth-code-abc',
        'state-xyz',
        expect.anything(),
      )
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Gmail Connected'))
      expect(res.status).not.toHaveBeenCalled()
    })

    // Callback logging regressions (no code/state/placeholder in logs) live in
    // connectors.controller.auth.spec.ts.

    it('provider error: vrátí 400 s error stránkou', async () => {
      const res = makeResponse()
      await controller.handleCallback(
        ConnectorType.GMAIL,
        '',
        '',
        'access_denied',
        makeRequest(),
        res as unknown as Response,
      )

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Connection Failed'))
      expect(mockConnectorsService.handleCallback).not.toHaveBeenCalled()
    })

    it('chybějící code: vrátí 400', async () => {
      const res = makeResponse()
      await controller.handleCallback(
        ConnectorType.GMAIL,
        '',
        'state-xyz',
        undefined,
        makeRequest(),
        res as unknown as Response,
      )

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockConnectorsService.handleCallback).not.toHaveBeenCalled()
    })

    it('service vyhodí výjimku: vrátí 400 s error stránkou', async () => {
      mockConnectorsService.handleCallback.mockRejectedValue(new Error('Invalid state token'))

      const res = makeResponse()
      await controller.handleCallback(
        ConnectorType.GMAIL,
        'code',
        'bad-state',
        undefined,
        makeRequest(),
        res as unknown as Response,
      )

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Invalid state token'))
    })
  })

  describe('getMonthlyWorklogIssues', () => {
    it('vrátí seřazený součet Jira + Clockify issues', async () => {
      mockJiraService.getWorklogIssuesForMonth.mockResolvedValueOnce([
        { issueId: 'PROJ-123', issueName: 'Fix login', totalSeconds: 3600 },
      ])
      mockClockifyService.getWorklogIssuesForMonth.mockResolvedValueOnce([
        { project: 'Internal', description: 'PROJ-55 standup', totalSeconds: 5400, jiraIssueKey: 'PROJ-55' },
      ])

      const result = await controller.getMonthlyWorklogIssues(
        { id: 'user-1', email: 'test@example.com', entraId: 'entra-1' },
        2026,
        5,
      )

      expect(result.success).toBe(true)
      expect(result.data.year).toBe(2026)
      expect(result.data.month).toBe(5)
      expect(result.data.issues).toHaveLength(2)
      expect(result.data.issues[0]).toMatchObject({
        source: 'jira',
        reference: 'PROJ-123',
        totalSeconds: 3600,
        jiraIssueKey: 'PROJ-123',
      })
      expect(result.data.issues[1]).toMatchObject({
        source: 'clockify',
        reference: 'Internal',
        totalSeconds: 5400,
        jiraIssueKey: 'PROJ-55',
      })
    })

    it('při chybě Jira vrátí pouze Clockify segment', async () => {
      mockJiraService.getWorklogIssuesForMonth.mockRejectedValueOnce(new Error('jira unavailable'))
      mockClockifyService.getWorklogIssuesForMonth.mockResolvedValueOnce([
        { project: 'Ops', description: 'Ops task', totalSeconds: 1800 },
      ])

      const result = await controller.getMonthlyWorklogIssues(
        undefined as unknown as never,
        2026,
        5,
      )

      expect(result.success).toBe(true)
      expect(result.data.issues).toHaveLength(1)
      expect(result.data.issues[0]).toMatchObject({
        source: 'clockify',
        reference: 'Ops',
        title: 'Ops task',
        totalSeconds: 1800,
      })
    })
  })

  describe('getWorklogsByIssue', () => {
    it('vrátí Jira detail položky pro konkrétní issue', async () => {
      mockJiraService.getWorklogEntriesForIssueInMonth.mockResolvedValueOnce([
        {
          id: 'wl-1',
          issueId: 'PROJ-55',
          issueName: 'Fix auth redirect',
          started: '2026-05-03T09:00:00.000+0000',
          timeSpentSeconds: 3600,
          comment: 'Investigace a fix',
        },
      ])

      const result = await controller.getWorklogsByIssue(
        { id: 'user-1', email: 'test@example.com', entraId: 'entra-1' },
        'jira',
        'PROJ-55',
        2026,
        5,
      )

      expect(result.success).toBe(true)
      expect(result.data.worklogs).toHaveLength(1)
      expect(result.data.worklogs[0]).toMatchObject({
        source: 'jira',
        id: 'wl-1',
        issueId: 'PROJ-55',
        timeSpentSeconds: 3600,
        description: 'Investigace a fix',
      })
    })

    it('vrátí Clockify detail položky pro konkrétní reference', async () => {
      mockClockifyService.getWorklogEntriesForIssueInMonth.mockResolvedValueOnce([
        {
          id: 'clk-1',
          project: 'Internal',
          description: 'Daily standup',
          started: '2026-05-04T09:00:00Z',
          timeSpentSeconds: 1800,
        },
      ])

      const result = await controller.getWorklogsByIssue(
        { id: 'user-1', email: 'test@example.com', entraId: 'entra-1' },
        'clockify',
        'Internal',
        2026,
        5,
      )

      expect(result.success).toBe(true)
      expect(result.data.worklogs).toHaveLength(1)
      expect(result.data.worklogs[0]).toMatchObject({
        source: 'clockify',
        id: 'clk-1',
        project: 'Internal',
        description: 'Daily standup',
        timeSpentSeconds: 1800,
      })
    })

    it('při chybě Jira vrátí prázdný seznam', async () => {
      mockJiraService.getWorklogEntriesForIssueInMonth.mockRejectedValueOnce(new Error('jira unavailable'))

      const result = await controller.getWorklogsByIssue(
        { id: 'user-1', email: 'test@example.com', entraId: 'entra-1' },
        'jira',
        'PROJ-55',
        2026,
        5,
      )

      expect(result.success).toBe(true)
      expect(result.data.worklogs).toEqual([])
    })
  })
})
