import { Test, TestingModule } from '@nestjs/testing'
import { HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SessionService } from './session.service'
import { Response } from 'express'

/** Vytvoří mock Express Response s chainem status().json() */
const mockResponse = () => {
  const res = {} as Response
  res.json = jest.fn().mockReturnValue(res)
  res.status = jest.fn().mockReturnValue(res)
  return res
}

describe('AuthController', () => {
  let controller: AuthController
  let authService: jest.Mocked<
    Pick<
      AuthService,
      | 'generateCodeVerifier'
      | 'generateCodeChallenge'
      | 'buildAuthorizationUrl'
      | 'storeState'
      | 'consumeState'
      | 'exchangeCodeForTokens'
      | 'decodeIdToken'
      | 'findOrCreateUser'
      | 'createSession'
      | 'createAccessToken'
    >
  >

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            generateCodeVerifier: jest.fn().mockReturnValue('verifier-123'),
            generateCodeChallenge: jest.fn().mockResolvedValue('challenge-abc'),
            buildAuthorizationUrl: jest
              .fn()
              .mockReturnValue('https://login.microsoftonline.com/auth'),
            storeState: jest.fn(),
            consumeState: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            decodeIdToken: jest.fn(),
            findOrCreateUser: jest.fn(),
            createSession: jest.fn(),
            createAccessToken: jest.fn().mockReturnValue('jwt.access.token'),
          },
        },
        {
          provide: SessionService,
          useValue: { invalidateAllSessions: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000/api/v1/auth/callback'),
            getOrThrow: jest.fn().mockReturnValue('value'),
          },
        },
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    authService = module.get(AuthService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('login', () => {
    it('uloží state a vrátí authUrl', async () => {
      const res = mockResponse()
      await controller.login(res)

      expect(authService.storeState).toHaveBeenCalledWith(expect.any(String), 'verifier-123')
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ authUrl: 'https://login.microsoftonline.com/auth' }),
        }),
      )
    })
  })

  describe('callback', () => {
    it('vrátí 400 při chybějícím code', async () => {
      const res = mockResponse()
      await controller.callback('', 'state', res)
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
      expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED' },
      })
    })

    it('vrátí 400 při chybějícím state', async () => {
      const res = mockResponse()
      await controller.callback('code', '', res)
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST)
    })

    it('vrátí 401 při nevalidním state – CSRF ochrana', async () => {
      ;(authService.consumeState as jest.Mock).mockReturnValue(null)
      const res = mockResponse()
      await controller.callback('code', 'invalid-state', res)
      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED)
      expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message: 'Invalid or expired state' },
      })
    })

    it('úspěšný callback vrátí accessToken a user – bez refreshToken v odpovědi', async () => {
      ;(authService.consumeState as jest.Mock).mockReturnValue('verifier-from-cache')
      ;(authService.exchangeCodeForTokens as jest.Mock).mockResolvedValue({
        accessToken: 'entra-at',
        refreshToken: 'secret-refresh',
        idToken: 'entra-id-token',
        expiresIn: 3600,
      })
      ;(authService.decodeIdToken as jest.Mock).mockReturnValue({
        oid: 'oid-1',
        email: 'user@contoso.com',
        name: 'Test User',
      })
      ;(authService.findOrCreateUser as jest.Mock).mockResolvedValue({
        id: 'user-uuid',
        entraId: 'oid-1',
        email: 'user@contoso.com',
        displayName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      ;(authService.createSession as jest.Mock).mockResolvedValue('session-uuid')

      const res = mockResponse()
      await controller.callback('auth-code', 'valid-state', res)

      // Správná odpověď
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            accessToken: 'jwt.access.token',
            expiresIn: 900,
            user: expect.objectContaining({
              id: 'user-uuid',
              email: 'user@contoso.com',
              entraId: 'oid-1',
            }),
          }),
        }),
      )

      // refreshToken nesmí být v odpovědi
      const responseBody = JSON.stringify((res.json as jest.Mock).mock.calls[0][0])
      expect(responseBody).not.toContain('secret-refresh')
      expect(responseBody).not.toContain('refreshToken')

      // exchangeCodeForTokens byl volán s codeVerifier z cache (ne z query)
      expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(
        expect.objectContaining({ codeVerifier: 'verifier-from-cache', code: 'auth-code' }),
      )
    })

    it('vrátí 401 při chybě token exchange', async () => {
      ;(authService.consumeState as jest.Mock).mockReturnValue('verifier')
      ;(authService.exchangeCodeForTokens as jest.Mock).mockRejectedValue(
        new Error('Token exchange failed: invalid_grant'),
      )

      const res = mockResponse()
      await controller.callback('bad-code', 'valid-state', res)

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED)
      expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
        success: false,
        error: {
          code: 'AUTH_CALLBACK_FAILED',
          message: expect.stringContaining('Token exchange failed'),
        },
      })
    })

    it('vrátí 401 při chybě decodeIdToken (nevalidní claims)', async () => {
      ;(authService.consumeState as jest.Mock).mockReturnValue('verifier')
      ;(authService.exchangeCodeForTokens as jest.Mock).mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: 'bad-token',
        expiresIn: 3600,
      })
      ;(authService.decodeIdToken as jest.Mock).mockImplementation(() => {
        throw new Error('id_token missing required claim: oid/sub')
      })

      const res = mockResponse()
      await controller.callback('code', 'state', res)

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED)
    })
  })
})
