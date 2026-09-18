import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { JwtPayload } from './jwt.strategy'

@Injectable()
export class AuthService {
  // In-memory state store pro OAuth PKCE/CSRF validaci.
  // Klíč: state string, hodnota: { codeVerifier, expiresAt }
  private readonly pendingStates = new Map<string, { codeVerifier: string; expiresAt: number }>()
  private readonly STATE_TTL_MS = 10 * 60 * 1000 // 10 minut

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Uloží codeVerifier mapovaný na state (pro CSRF validaci).
   */
  async storeState(state: string, codeVerifier: string): Promise<void> {
    const now = Date.now()
    for (const [key, value] of this.pendingStates.entries()) {
      if (value.expiresAt < now) this.pendingStates.delete(key)
    }
    this.pendingStates.set(state, { codeVerifier, expiresAt: now + this.STATE_TTL_MS })
  }

  /**
   * Validuje state a vrátí odpovídající codeVerifier (nebo null).
   * State je single-use – po prvním použití se smaže.
   */
  async consumeState(state: string): Promise<string | null> {
    const entry = this.pendingStates.get(state)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.pendingStates.delete(state)
      return null
    }
    this.pendingStates.delete(state) // single-use
    return entry.codeVerifier
  }

  /**
   * Generuje PKCE code_verifier (base64url, 43-128 znaků)
   */
  generateCodeVerifier(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return Buffer.from(array).toString('base64url').slice(0, 128)
  }

  /**
   * Generuje code_challenge z code_verifier (SHA-256, base64url)
   */
  async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(codeVerifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Buffer.from(digest).toString('base64url')
  }

  /**
   * Sestaví Entra ID authorization URL – selže pokud chybí konfigurace
   */
  buildAuthorizationUrl(codeChallenge: string, state: string): string {
    const tenantId = this.config.getOrThrow<string>('ENTRA_TENANT_ID')
    const clientId = this.config.getOrThrow<string>('ENTRA_CLIENT_ID')
    const redirectUri = this.config.getOrThrow<string>('ENTRA_REDIRECT_URI')

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'openid profile email offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    })

    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`
  }

  /**
   * Vytvoří JWT access token pro uživatele
   */
  createAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload)
  }

  /**
   * Najde nebo vytvoří uživatele v DB dle entraId.
   * Při konfliktu unikátního emailu (P2002) vyhodí chybu s kódem AUTH_EMAIL_CONFLICT.
   */
  async findOrCreateUser(params: { entraId: string; email: string; displayName: string }) {
    try {
      return await this.prisma.user.upsert({
        where: { entraId: params.entraId },
        update: {
          email: params.email,
          displayName: params.displayName,
        },
        create: {
          entraId: params.entraId,
          email: params.email,
          displayName: params.displayName,
        },
      })
    } catch (error: unknown) {
      // Prisma unique constraint violation (P2002) na email
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new Error(
          `AUTH_EMAIL_CONFLICT: User with email ${params.email} already exists with different Entra ID. ` +
            `Manual resolution required.`,
        )
      }
      throw error
    }
  }

  /**
   * Najde nebo vytvoří uživatele v DB dle googleId.
   */
  async findOrCreateGoogleUser(params: { googleId: string; email: string; displayName: string }) {
    return this.prisma.user.upsert({
      where: { googleId: params.googleId },
      update: {
        email: params.email,
        displayName: params.displayName,
      },
      create: {
        googleId: params.googleId,
        email: params.email,
        displayName: params.displayName,
      },
    })
  }

  /**
   * Vymění authorization_code za Entra ID tokeny (PKCE flow)
   */
  async exchangeCodeForTokens(params: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{
    accessToken: string
    refreshToken: string
    idToken: string
    expiresIn: number
  }> {
    const tenantId = this.config.getOrThrow<string>('ENTRA_TENANT_ID')
    const clientId = this.config.getOrThrow<string>('ENTRA_CLIENT_ID')

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    })

    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token exchange failed: ${error}`)
    }

    const data = await response.json()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresIn: data.expires_in,
    }
  }

  /**
   * Dekóduje Entra ID id_token (bez verifikace – pouze pro user info)
   * Verifikaci přenecháme JWT strategii
   */
  decodeIdToken(idToken: string): { oid: string; email: string; name: string } {
    const parts = idToken.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid id_token format')
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    } catch {
      throw new Error('Failed to parse id_token payload')
    }

    // Validace povinných claimů
    const oid = (payload['oid'] ?? payload['sub']) as string | undefined
    const email = (payload['email'] ?? payload['preferred_username']) as string | undefined
    const name = payload['name'] as string | undefined

    if (!oid || typeof oid !== 'string') {
      throw new Error('id_token missing required claim: oid/sub')
    }
    if (!email || typeof email !== 'string') {
      throw new Error('id_token missing required claim: email/preferred_username')
    }

    return {
      oid,
      email,
      name: name ?? 'Unknown',
    }
  }

  /**
   * Uloží session s zahashovaným refresh tokenem
   */
  async createSession(params: {
    userId: string
    refreshToken: string
    expiresInDays?: number
  }): Promise<string> {
    const SALT_ROUNDS = 12
    const refreshTokenHash = await bcrypt.hash(params.refreshToken, SALT_ROUNDS)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (params.expiresInDays ?? 30))

    const session = await this.prisma.session.create({
      data: {
        userId: params.userId,
        refreshTokenHash,
        expiresAt,
      },
    })
    return session.id
  }

  /**
   * Provede refresh access tokenu pomocí Entra ID refresh tokenu
   */
  async refreshAccessToken(params: {
    refreshToken: string
  }): Promise<{ accessToken: string; expiresIn: number }> {
    const tenantId = this.config.getOrThrow<string>('ENTRA_TENANT_ID')
    const clientId = this.config.getOrThrow<string>('ENTRA_CLIENT_ID')

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      scope: 'openid profile email offline_access',
    })

    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token refresh failed: ${error}`)
    }

    const data = await response.json()
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    }
  }

  /**
   * Invaliduje session (logout)
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.prisma.session
      .delete({
        where: { id: sessionId },
      })
      .catch(() => {
        // Session nemusí existovat – OK
      })
  }

  /**
   * Validuje session token z httpOnly cookie (formát: sessionId.rawToken).
   * O(1) lookup podle session ID, poté bcrypt porovnání.
   */
  async validateSessionToken(
    cookieValue: string,
  ): Promise<{ user: { id: string; email: string; displayName: string; googleId: string | null; entraId: string | null }; sessionId: string } | null> {
    const dotIdx = cookieValue.indexOf('.')
    if (dotIdx === -1) return null
    const sessionId = cookieValue.slice(0, dotIdx)
    const rawToken = cookieValue.slice(dotIdx + 1)

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    })
    if (!session || session.expiresAt < new Date()) return null

    const match = await bcrypt.compare(rawToken, session.refreshTokenHash)
    if (!match) return null

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        googleId: session.user.googleId,
        entraId: session.user.entraId,
      },
      sessionId: session.id,
    }
  }
}
