import { describe, it, expect, expectTypeOf } from 'vitest'
import type { UserProfile, LoginResponse, SessionInfo, AuthErrorCode } from './auth'

describe('UserProfile', () => {
  it('should have required fields', () => {
    const profile: UserProfile = {
      id: 'user-1',
      entraId: 'entra-abc',
      email: 'test@example.com',
      displayName: 'Test User',
    }
    expectTypeOf(profile).toMatchTypeOf<UserProfile>()
  })
})

describe('LoginResponse', () => {
  it('should have accessToken, expiresIn and user', () => {
    const response: LoginResponse = {
      accessToken: 'jwt.token.here',
      expiresIn: 900,
      user: {
        id: 'user-1',
        entraId: 'entra-abc',
        email: 'test@example.com',
        displayName: 'Test User',
      },
    }
    expectTypeOf(response).toMatchTypeOf<LoginResponse>()
  })
})

describe('SessionInfo', () => {
  it('should have user and expiresAt', () => {
    const session: SessionInfo = {
      user: {
        id: 'user-1',
        entraId: 'entra-abc',
        email: 'test@example.com',
        displayName: 'Test User',
      },
      expiresAt: new Date().toISOString(),
    }
    expectTypeOf(session).toMatchTypeOf<SessionInfo>()
  })
})

describe('AuthErrorCode', () => {
  it('should only allow valid error codes', () => {
    const valid: AuthErrorCode[] = [
      'AUTH_INVALID_TOKEN',
      'AUTH_TOKEN_EXPIRED',
      'AUTH_UNAUTHORIZED',
      'AUTH_CALLBACK_FAILED',
      'AUTH_SESSION_NOT_FOUND',
    ]
    expectTypeOf(valid).toMatchTypeOf<AuthErrorCode[]>()
  })
})

describe('re-export from index', () => {
  it('should be importable from package root', async () => {
    const mod = await import('./index')
    // Typy jsou erasable at runtime – ověřujeme pouze přítomnost modulu
    expect(mod).toBeDefined()
  })
})
