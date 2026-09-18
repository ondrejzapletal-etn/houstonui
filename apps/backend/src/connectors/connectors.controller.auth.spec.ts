/**
 * ConnectorsController – authentication regressions.
 *
 * Kept separate from connectors.controller.spec.ts, which currently fails to
 * compile for an unrelated reason (it references a `getWorklogsByIssue` handler
 * that does not exist on the controller). These assertions must run today, so
 * they live in their own file.
 *
 * What they lock down, from the security audit:
 *  - `POST /connectors/:type/connect` and `/disconnect` were @Public and fell
 *    back to a shared 'dev-user-placeholder' identity, so anyone could bind an
 *    attacker-controlled Clockify/HOT SPOT API key or destroy a user's
 *    credential. There must be no environment in which that fallback returns.
 *  - The OAuth callback logged the authorization code and state in plaintext.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorType } from '@prisma/client'
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

const ALL_ENVS = ['development', 'test', 'production']

function makeRequest(): Request {
  return {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request
}

function makeResponse() {
  const res = { status: jest.fn(), send: jest.fn() }
  res.status.mockReturnValue(res)
  res.send.mockReturnValue(res)
  return res
}

const mockConnectorsService = {
  listConnectorsInfo: jest.fn(),
  initiateConnect: jest.fn(),
  handleCallback: jest.fn(),
  disconnect: jest.fn(),
}
const mockClockifyService = { connectWithApiKey: jest.fn() }
const mockHotSpotService = { connectWithApiKey: jest.fn(), isInternalNetworkAvailable: jest.fn() }
const mockUnreadCountService = { fetchForUser: jest.fn() }

let mockNodeEnv = 'development'
const mockConfigService = {
  get: jest.fn((key: string) => (key === 'NODE_ENV' ? mockNodeEnv : undefined)),
}

describe('ConnectorsController – authentication', () => {
  let controller: ConnectorsController

  beforeEach(async () => {
    jest.clearAllMocks()
    mockNodeEnv = 'development'

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: UnreadCountService, useValue: mockUnreadCountService },
        { provide: JiraService, useValue: {} },
        { provide: ClockifyService, useValue: mockClockifyService },
        { provide: HotSpotService, useValue: mockHotSpotService },
        { provide: UsersService, useValue: {} },
        { provide: TimeSavedService, useValue: { record: jest.fn() } },
        { provide: KnowledgeService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: GmailService, useValue: {} },
        { provide: SlackService, useValue: {} },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile()

    controller = module.get(ConnectorsController)
    jest.spyOn(controller['logger'], 'error').mockImplementation(() => undefined)
  })

  describe('initiateConnect', () => {
    it('passes the authenticated user id through to the service', async () => {
      mockConnectorsService.initiateConnect.mockReturnValue({ authUrl: 'https://example.test/auth' })

      await controller.initiateConnect(
        { id: 'user-123', email: 'a@b.c', entraId: 'entra-1' },
        ConnectorType.GMAIL,
        makeRequest(),
        {},
      )

      expect(mockConnectorsService.initiateConnect).toHaveBeenCalledWith(
        'user-123',
        ConnectorType.GMAIL,
        expect.anything(),
      )
    })

    it.each(ALL_ENVS)('refuses an unauthenticated caller (NODE_ENV=%s)', async (env) => {
      mockNodeEnv = env

      await expect(
        controller.initiateConnect(
          undefined as unknown as never,
          ConnectorType.GMAIL,
          makeRequest(),
          {},
        ),
      ).rejects.toThrow(UnauthorizedException)

      expect(mockConnectorsService.initiateConnect).not.toHaveBeenCalled()
    })

    it.each(ALL_ENVS)(
      'refuses to store a Clockify API key for an unauthenticated caller (NODE_ENV=%s)',
      async (env) => {
        mockNodeEnv = env

        await expect(
          controller.initiateConnect(
            undefined as unknown as never,
            ConnectorType.CLOCKIFY,
            makeRequest(),
            { apiKey: 'attacker-supplied-key' },
          ),
        ).rejects.toThrow(UnauthorizedException)

        expect(mockClockifyService.connectWithApiKey).not.toHaveBeenCalled()
      },
    )
  })

  describe('disconnect', () => {
    it.each(ALL_ENVS)(
      'refuses to revoke a credential for an unauthenticated caller (NODE_ENV=%s)',
      async (env) => {
        mockNodeEnv = env

        await expect(
          controller.disconnect(
            undefined as unknown as never,
            ConnectorType.GMAIL,
            makeRequest(),
          ),
        ).rejects.toThrow(UnauthorizedException)

        expect(mockConnectorsService.disconnect).not.toHaveBeenCalled()
      },
    )
  })

  describe('handleCallback', () => {
    it('never logs the authorization code or state', async () => {
      mockConnectorsService.handleCallback.mockResolvedValue({
        userId: 'real-user-id',
        connectorType: ConnectorType.GMAIL,
      })

      const log = jest.spyOn(controller['logger'], 'log').mockImplementation(() => undefined)
      const warn = jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined)

      const res = makeResponse()
      await controller.handleCallback(
        ConnectorType.GMAIL,
        'secret-auth-code',
        'secret-state',
        undefined,
        makeRequest(),
        res as unknown as Response,
      )

      const logged = [...log.mock.calls, ...warn.mock.calls]
        .map((args) => String(args[0]))
        .join('\n')

      expect(logged).toContain('real-user-id')
      expect(logged).not.toContain('secret-auth-code')
      expect(logged).not.toContain('secret-state')
    })

    it.each(['development', 'production'])(
      'never mentions the dev placeholder (NODE_ENV=%s)',
      async (env) => {
        mockNodeEnv = env
        mockConnectorsService.handleCallback.mockResolvedValue({
          userId: 'real-user-id',
          connectorType: ConnectorType.GMAIL,
        })

        const log = jest.spyOn(controller['logger'], 'log').mockImplementation(() => undefined)
        const warn = jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined)

        const res = makeResponse()
        await controller.handleCallback(
          ConnectorType.GMAIL,
          'code',
          'state',
          undefined,
          makeRequest(),
          res as unknown as Response,
        )

        const logged = [...log.mock.calls, ...warn.mock.calls]
          .map((args) => String(args[0]))
          .join('\n')

        expect(logged).not.toContain('dev-user-placeholder')
        expect(logged).not.toContain('[DEV-ONLY]')
      },
    )
  })
})
