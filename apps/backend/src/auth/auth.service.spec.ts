import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}

const mockPrismaService = {
  user: {
    upsert: jest.fn(),
  },
  session: {
    create: jest.fn(),
    delete: jest.fn(),
  },
}

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      ENTRA_TENANT_ID: 'test-tenant',
      ENTRA_CLIENT_ID: 'test-client-id',
      ENTRA_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/callback',
      JWT_SECRET: 'test-secret',
    }
    if (key in values) return values[key]
    throw new Error(`Config key not found: ${key}`)
  }),
}

describe('AuthService', () => {
  let service: AuthService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('generateCodeVerifier', () => {
    it('should return a base64url string of length <= 128', () => {
      const verifier = service.generateCodeVerifier()
      expect(typeof verifier).toBe('string')
      expect(verifier.length).toBeGreaterThanOrEqual(43)
      expect(verifier.length).toBeLessThanOrEqual(128)
      // base64url characters only
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('should generate unique verifiers each call', () => {
      const v1 = service.generateCodeVerifier()
      const v2 = service.generateCodeVerifier()
      expect(v1).not.toBe(v2)
    })
  })

  describe('generateCodeChallenge', () => {
    it('should return a base64url string', async () => {
      const verifier = service.generateCodeVerifier()
      const challenge = await service.generateCodeChallenge(verifier)
      expect(typeof challenge).toBe('string')
      expect(challenge.length).toBeGreaterThan(0)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('should produce deterministic output for same input', async () => {
      const verifier = 'test-verifier-string-fixed'
      const c1 = await service.generateCodeChallenge(verifier)
      const c2 = await service.generateCodeChallenge(verifier)
      expect(c1).toBe(c2)
    })

    it('should produce different challenges for different verifiers', async () => {
      const c1 = await service.generateCodeChallenge('verifier-one')
      const c2 = await service.generateCodeChallenge('verifier-two')
      expect(c1).not.toBe(c2)
    })
  })

  describe('buildAuthorizationUrl', () => {
    it('should return a valid Microsoft login URL', () => {
      const url = service.buildAuthorizationUrl('challenge123', 'state456')
      expect(url).toContain('https://login.microsoftonline.com/')
      expect(url).toContain('oauth2/v2.0/authorize')
      expect(url).toContain('code_challenge=challenge123')
      expect(url).toContain('state=state456')
      expect(url).toContain('code_challenge_method=S256')
      expect(url).toContain('response_type=code')
    })

    it('should include openid scope', () => {
      const url = service.buildAuthorizationUrl('ch', 'st')
      expect(url).toContain('openid')
    })

    it('should use tenant id from config', () => {
      const url = service.buildAuthorizationUrl('ch', 'st')
      expect(url).toContain('test-tenant')
    })

    it('should throw when ENTRA_TENANT_ID is missing', () => {
      mockConfigService.getOrThrow.mockImplementationOnce((key: string) => {
        if (key === 'ENTRA_TENANT_ID') throw new Error('Config key not found: ENTRA_TENANT_ID')
        return 'value'
      })
      expect(() => service.buildAuthorizationUrl('ch', 'st')).toThrow()
    })
  })

  describe('createAccessToken', () => {
    it('should call jwtService.sign with the payload', () => {
      const payload = { sub: 'user-id', email: 'test@test.com', entraId: 'entra-id' }
      const token = service.createAccessToken(payload)
      expect(mockJwtService.sign).toHaveBeenCalledWith(payload)
      expect(token).toBe('mock-jwt-token')
    })
  })

  describe('findOrCreateUser', () => {
    it('should call prisma.user.upsert with correct params', async () => {
      const params = { entraId: 'entra-123', email: 'user@test.com', displayName: 'Test User' }
      const mockUser = {
        id: 'cuid',
        ...params,
        createdAt: new Date(),
        updatedAt: new Date(),
        sessions: [],
      }
      mockPrismaService.user.upsert.mockResolvedValue(mockUser)

      const result = await service.findOrCreateUser(params)

      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith({
        where: { entraId: params.entraId },
        update: { email: params.email, displayName: params.displayName },
        create: { entraId: params.entraId, email: params.email, displayName: params.displayName },
      })
      expect(result).toEqual(mockUser)
    })

    it('should throw AUTH_EMAIL_CONFLICT when Prisma P2002 is raised', async () => {
      const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      mockPrismaService.user.upsert.mockRejectedValue(prismaError)

      await expect(
        service.findOrCreateUser({
          entraId: 'entra-new',
          email: 'conflict@test.com',
          displayName: 'Conflict User',
        }),
      ).rejects.toThrow('AUTH_EMAIL_CONFLICT')
    })

    it('should rethrow non-P2002 errors as-is', async () => {
      const dbError = new Error('Connection refused')
      mockPrismaService.user.upsert.mockRejectedValue(dbError)

      await expect(
        service.findOrCreateUser({ entraId: 'e', email: 'x@x.com', displayName: 'X' }),
      ).rejects.toThrow('Connection refused')
    })
  })

  describe('storeState / consumeState', () => {
    it('consumeState vrátí codeVerifier pro validní state', () => {
      service.storeState('my-state', 'my-verifier')
      expect(service.consumeState('my-state')).toBe('my-verifier')
    })

    it('consumeState je single-use – druhý pokus vrátí null', () => {
      service.storeState('once-state', 'verifier')
      service.consumeState('once-state')
      expect(service.consumeState('once-state')).toBeNull()
    })

    it('consumeState vrátí null pro neznámý state', () => {
      expect(service.consumeState('unknown')).toBeNull()
    })

    it('consumeState vrátí null pro expirovaný state', () => {
      // Manipulujeme s interním Map pro simulaci expirace
      const pendingStates = (service as unknown as Record<string, unknown>)['pendingStates'] as Map<
        string,
        { codeVerifier: string; expiresAt: number }
      >
      pendingStates.set('expired-state', { codeVerifier: 'v', expiresAt: Date.now() - 1 })
      expect(service.consumeState('expired-state')).toBeNull()
    })

    it('storeState vyčistí expirované záznamy', () => {
      const pendingStates = (service as unknown as Record<string, unknown>)['pendingStates'] as Map<
        string,
        { codeVerifier: string; expiresAt: number }
      >
      pendingStates.set('old-state', { codeVerifier: 'v', expiresAt: Date.now() - 1 })
      expect(pendingStates.has('old-state')).toBe(true)

      service.storeState('new-state', 'new-verifier')

      expect(pendingStates.has('old-state')).toBe(false)
      expect(pendingStates.has('new-state')).toBe(true)
    })
  })

  describe('decodeIdToken', () => {
    function makeIdToken(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      return `${header}.${body}.signature`
    }

    it('should decode oid, email and name from token payload', () => {
      const token = makeIdToken({
        oid: 'obj-id-123',
        email: 'user@contoso.com',
        name: 'Jane Doe',
      })
      const result = service.decodeIdToken(token)
      expect(result).toEqual({ oid: 'obj-id-123', email: 'user@contoso.com', name: 'Jane Doe' })
    })

    it('should fall back to sub when oid is absent', () => {
      const token = makeIdToken({
        sub: 'sub-id',
        preferred_username: 'user@contoso.com',
        name: 'John',
      })
      const result = service.decodeIdToken(token)
      expect(result.oid).toBe('sub-id')
      expect(result.email).toBe('user@contoso.com')
    })

    it('should fall back to preferred_username when email is absent', () => {
      const token = makeIdToken({ oid: 'oid', preferred_username: 'pref@user.com', name: 'X' })
      const result = service.decodeIdToken(token)
      expect(result.email).toBe('pref@user.com')
    })

    it('should use "Unknown" as name fallback', () => {
      const token = makeIdToken({ oid: 'oid', email: 'e@e.com' })
      const result = service.decodeIdToken(token)
      expect(result.name).toBe('Unknown')
    })

    it('should throw for invalid token format', () => {
      expect(() => service.decodeIdToken('only.two')).toThrow('Invalid id_token format')
      expect(() => service.decodeIdToken('no-dots')).toThrow('Invalid id_token format')
    })

    it('should throw when payload JSON is invalid', () => {
      const header = Buffer.from('{}').toString('base64url')
      const badBody = 'not-valid-json!!!'
      expect(() => service.decodeIdToken(`${header}.${badBody}.sig`)).toThrow(
        'Failed to parse id_token payload',
      )
    })

    it('should throw when oid and sub are both missing', () => {
      const token = makeIdToken({ email: 'e@e.com', name: 'X' })
      expect(() => service.decodeIdToken(token)).toThrow('id_token missing required claim: oid/sub')
    })

    it('should throw when email and preferred_username are both missing', () => {
      const token = makeIdToken({ oid: 'oid', name: 'X' })
      expect(() => service.decodeIdToken(token)).toThrow(
        'id_token missing required claim: email/preferred_username',
      )
    })
  })

  describe('exchangeCodeForTokens', () => {
    const mockTokenResponse = {
      access_token: 'entra-access',
      refresh_token: 'entra-refresh',
      id_token: 'entra-id-token',
      expires_in: 3600,
    }

    it('should call fetch with correct parameters and return mapped tokens', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockTokenResponse),
      })
      global.fetch = mockFetch as unknown as typeof fetch

      const result = await service.exchangeCodeForTokens({
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost/callback',
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('oauth2/v2.0/token')
      expect(url).toContain('test-tenant')
      expect(opts.method).toBe('POST')

      const body = new URLSearchParams(opts.body as string)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('auth-code')
      expect(body.get('code_verifier')).toBe('verifier')
      expect(body.get('redirect_uri')).toBe('http://localhost/callback')

      expect(result).toEqual({
        accessToken: 'entra-access',
        refreshToken: 'entra-refresh',
        idToken: 'entra-id-token',
        expiresIn: 3600,
      })
    })

    it('should throw when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: jest.fn().mockResolvedValue('bad_request'),
      }) as unknown as typeof fetch

      await expect(
        service.exchangeCodeForTokens({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }),
      ).rejects.toThrow('Token exchange failed')
    })
  })

  describe('createSession', () => {
    it('should hash the refresh token and create a session in db', async () => {
      const sessionId = 'session-cuid'
      mockPrismaService.session.create.mockResolvedValue({ id: sessionId })

      const result = await service.createSession({
        userId: 'user-id',
        refreshToken: 'plain-refresh-token',
      })

      expect(result).toBe(sessionId)
      expect(mockPrismaService.session.create).toHaveBeenCalledTimes(1)

      const createCall = mockPrismaService.session.create.mock.calls[0][0] as {
        data: { userId: string; refreshTokenHash: string; expiresAt: Date }
      }
      expect(createCall.data.userId).toBe('user-id')
      // Stored value must NOT be plaintext
      expect(createCall.data.refreshTokenHash).not.toBe('plain-refresh-token')
      // Must be a bcrypt hash (starts with $2a$ or $2b$)
      expect(createCall.data.refreshTokenHash).toMatch(/^\$2[ab]\$/)
      expect(createCall.data.expiresAt).toBeInstanceOf(Date)
    })

    it('should respect custom expiresInDays', async () => {
      mockPrismaService.session.create.mockResolvedValue({ id: 'sid' })
      const before = new Date()
      await service.createSession({ userId: 'u', refreshToken: 'r', expiresInDays: 7 })
      const createCall = mockPrismaService.session.create.mock.calls[0][0] as {
        data: { expiresAt: Date }
      }
      const diffDays =
        (createCall.data.expiresAt.getTime() - before.getTime()) / (1000 * 60 * 60 * 24)
      expect(diffDays).toBeGreaterThanOrEqual(6.9)
      expect(diffDays).toBeLessThanOrEqual(7.1)
    })
  })

  describe('refreshAccessToken', () => {
    it('should call fetch with refresh_token grant and return accessToken', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ access_token: 'new-access', expires_in: 900 }),
      })
      global.fetch = mockFetch as unknown as typeof fetch

      const result = await service.refreshAccessToken({ refreshToken: 'my-refresh' })

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('oauth2/v2.0/token')
      const body = new URLSearchParams(opts.body as string)
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('my-refresh')

      expect(result).toEqual({ accessToken: 'new-access', expiresIn: 900 })
    })

    it('should throw when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: jest.fn().mockResolvedValue('expired'),
      }) as unknown as typeof fetch

      await expect(service.refreshAccessToken({ refreshToken: 'bad' })).rejects.toThrow(
        'Token refresh failed',
      )
    })
  })

  describe('deleteSession', () => {
    it('should call prisma.session.delete with the session id', async () => {
      mockPrismaService.session.delete.mockResolvedValue({ id: 'session-id' })
      await service.deleteSession('session-id')
      expect(mockPrismaService.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-id' },
      })
    })

    it('should not throw when session does not exist', async () => {
      mockPrismaService.session.delete.mockRejectedValue(new Error('Not found'))
      await expect(service.deleteSession('non-existent')).resolves.toBeUndefined()
    })
  })
})
