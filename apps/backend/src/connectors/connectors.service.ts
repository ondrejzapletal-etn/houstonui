/**
 * ConnectorsService
 *
 * Handles OAuth2 flow orchestration for Gmail and Slack connectors:
 *   1. initiateConnect  – build authorization URL, store single-use CSRF state
 *   2. handleCallback   – exchange code for tokens, persist via ConnectorCredentialsService
 *   3. getStatus        – return frontend-safe status (no tokens)
 *   4. disconnect       – delegate revocation to ConnectorCredentialsService
 *
 * SECURITY:
 *  - No token values are ever returned to callers or the frontend.
 *  - CSRF state is single-use and expires after 10 minutes.
 *  - Provider secrets (client_id / client_secret) are read exclusively from ConfigService.
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
// NOTE: ConnectorType / ConnectorStatus are Prisma-generated enums.
// The import resolves at runtime after `prisma generate`. LSP errors in dev are expected.
import { ConnectorType, ConnectorStatus } from '@prisma/client'
import { ConnectorCredentialsService } from './connector-credentials.service'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type {
  ConnectorConnectionStatus,
  ConnectorInfo,
  ConnectorsListResponse,
} from './connector.types'

// ─── Public result types ──────────────────────────────────────────────────────

/** Frontend-safe connector status (contains no token data). */
export interface ConnectorStatusResult {
  type: 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot'
  status: ConnectorConnectionStatus
  connectedAt?: string // ISO 8601 timestamp
  errorMessage?: string
}

export interface ConnectorConnectResult {
  /** Authorization URL to open in the system browser. */
  authUrl: string
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ProviderConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
}

/** Input accepted by storePendingState (expiresAt is assigned internally). */
type PendingStateInput = { userId: string; connectorType: ConnectorType; codeVerifier: string }

interface PendingState extends PendingStateInput {
  expiresAt: number
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name)

  /** Single-use CSRF state store – maps state token → pending OAuth session. */
  private readonly pendingStates = new Map<string, PendingState>()
  private readonly STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

  constructor(
    private readonly credentials: ConnectorCredentialsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  // ── List (dashboard) ─────────────────────────────────────────────────────

  /**
   * Returns ConnectorInfo[] for all supported connectors for the given user.
   * Unread counts come from the DB cache populated by UnreadCountService.
   * Connectors with no credential record are returned with status 'not_connected'.
   *
   * This endpoint is the primary data source for the dashboard SourcesSection.
   */
  async listConnectorsInfo(userId: string): Promise<ConnectorsListResponse> {
    const records = await this.prisma.connectorCredential.findMany({
      where: { userId },
      select: {
        connectorType: true,
        status: true,
        unreadCount: true,
        unreadCountFetchedAt: true,
      },
    })

    const byType = new Map(records.map((r) => [r.connectorType as ConnectorType, r]))

    const SUPPORTED: Array<{
      id: 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot'
      prismaType: ConnectorType
      label: string
    }> = [
      { id: 'gmail', prismaType: ConnectorType.GMAIL, label: 'Google' },
      { id: 'slack', prismaType: ConnectorType.SLACK, label: 'Slack' },
      { id: 'jira', prismaType: ConnectorType.JIRA, label: 'Jira' },
      { id: 'clockify', prismaType: ConnectorType.CLOCKIFY, label: 'Clockify' },
      { id: 'hotspot', prismaType: ConnectorType.HOTSPOT, label: 'Hot Spot' },
    ]

    const connectors: ConnectorInfo[] = []
    for (const { id, prismaType, label } of SUPPORTED) {
      const record = byType.get(prismaType)

      if (!record) {
        connectors.push({ id, label, status: 'not_connected', unreadCount: null, lastCheckedAt: null })
        continue
      }

      let status = this.toFrontendStatus(record.status as ConnectorStatus)
      let errorMessage: string | undefined = undefined
      let unreadCount = null
      let lastCheckedAt = null

      // Special handling for Jira: check credential validity (cloudId/accountId)
      if (id === 'jira' && status === 'connected') {
        try {
          const meta = await this.credentials.getMetadata(userId, prismaType)
          const tokens = await this.credentials.getTokens(userId, prismaType)
          if (!meta.externalAccountId || !tokens.accountId) {
            status = 'error'
            errorMessage = 'Jira credentials are missing required identifiers. Please reconnect Jira.'
          } else {
            unreadCount = record.unreadCount ?? null
            lastCheckedAt = record.unreadCountFetchedAt ? record.unreadCountFetchedAt.toISOString() : null
          }
        } catch (err) {
          status = 'error'
          errorMessage = 'Jira credentials could not be validated. Please reconnect Jira.'
        }
      } else {
        if (status === 'connected') {
          unreadCount = record.unreadCount ?? null
          lastCheckedAt = record.unreadCountFetchedAt ? record.unreadCountFetchedAt.toISOString() : null
        }
      }

      connectors.push({
        id,
        label,
        status,
        unreadCount,
        lastCheckedAt,
        ...(errorMessage ? { errorMessage } : {}),
      })
    }

    return { connectors }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * Returns connection status for a single connector.
   * Never exposes token data.
   */
  async getStatus(userId: string, type: ConnectorType): Promise<ConnectorStatusResult> {
    try {
      const meta = await this.credentials.getMetadata(userId, type)
      const status = this.toFrontendStatus(meta.status)
      const needsReauth =
        meta.status === ConnectorStatus.EXPIRED || meta.status === ConnectorStatus.INVALID
      return {
        type: this.toFrontendType(type),
        status,
        connectedAt: meta.updatedAt.toISOString(),
        ...(needsReauth ? { errorMessage: 'Re-authorisation required.' } : {}),
      }
    } catch {
      // CredentialNotFoundException → user has never connected
      return { type: this.toFrontendType(type), status: 'not_connected' }
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  /**
   * Generates an OAuth authorization URL with PKCE (S256) for the given connector type.
   * The PKCE code_verifier is stored server-side and consumed during the callback.
   * A CSRF state token is also registered.
   *
   * @param userId    Authenticated user id (from JWT)
   * @param type      ConnectorType.GMAIL | ConnectorType.SLACK
   * @param ipAddress Source IP for audit logging
   */
  initiateConnect(userId: string, type: ConnectorType, ipAddress?: string): ConnectorConnectResult {
    // Clockify uses API key authentication, not OAuth.
    // It has a dedicated endpoint: POST /connectors/clockify/connect
    if (type === ConnectorType.CLOCKIFY) {
      throw new BadRequestException(
        'Clockify uses API key authentication. Use POST /connectors/clockify/connect with { apiKey } in the request body.',
      )
    }

    const provider = this.getProviderConfig(type)

    // PKCE S256: code_verifier = 32 random bytes (base64url), code_challenge = SHA-256(verifier)
    // Slack OAuth v2 does not support PKCE – codeVerifier is set to empty string so it is
    // omitted from the token exchange request body (see exchangeCode).
    const usePkce = type !== ConnectorType.SLACK
    const codeVerifier = usePkce ? randomBytes(32).toString('base64url') : ''
    const codeChallenge = usePkce ? createHash('sha256').update(codeVerifier).digest('base64url') : ''

    // CSRF state token
    const state = randomBytes(32).toString('base64url')
    this.storePendingState(state, { userId, connectorType: type, codeVerifier })

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
    })

    if (usePkce) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }

    if (type === ConnectorType.GMAIL) {
      params.set('access_type', 'offline')
      params.set('prompt', 'consent') // Force consent so Google issues a refresh token
    }

    if (type === ConnectorType.CALENDAR) {
      params.set('access_type', 'offline')
      params.set('prompt', 'consent')
    }

    if (type === ConnectorType.SLACK) {
      // Slack OAuth v2 uses user_scope for user token permissions (not scope).
      // PKCE (code_challenge / code_challenge_method) is not supported by Slack.
      params.delete('scope')
      params.delete('code_challenge')
      params.delete('code_challenge_method')
      params.set('user_scope', provider.scopes.join(','))
    }

    if (type === ConnectorType.JIRA) {
      params.set('audience', 'api.atlassian.com')
      params.set('prompt', 'consent') // Ensure offline_access refresh token is issued
    }

    const authUrl = `${provider.authorizationUrl}?${params.toString()}`
    this.logger.debug(`OAuth PKCE initiation: user=${userId} connector=${type}`)
    this.audit.log('connector.connect.initiated', {
      userId,
      connectorType: type,
      metadata: { outcome: 'success' },
      ipAddress,
    })
    return { authUrl }
  }

  // ── OAuth Callback ────────────────────────────────────────────────────────

  /**
   * Handles the provider's OAuth redirect.
   * Validates CSRF state, exchanges the authorization code with PKCE code_verifier,
   * persists tokens via ConnectorCredentialsService (tokens → Key Vault, metadata → DB).
   */
  async handleCallback(
    code: string,
    state: string,
    ipAddress?: string,
  ): Promise<{ userId: string; connectorType: ConnectorType }> {
    const pending = this.consumePendingState(state)
    if (!pending) {
      throw new BadRequestException(
        'Invalid or expired OAuth state. Please start the connection flow again.',
      )
    }

    const { userId, connectorType, codeVerifier } = pending
    const provider = this.getProviderConfig(connectorType)

    let tokens: Awaited<ReturnType<typeof this.exchangeCode>>
    try {
      tokens = await this.exchangeCode(code, codeVerifier, provider, connectorType)
    } catch (err: unknown) {
      this.audit.log('connector.connect.failed', {
        userId,
        connectorType,
        metadata: {
          outcome: 'failure',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        ipAddress,
      })
      throw err
    }

    if (connectorType === ConnectorType.JIRA && !tokens.refreshToken) {
      this.audit.log('connector.connect.failed', {
        userId,
        connectorType,
        metadata: {
          outcome: 'failure',
          errorMessage: 'Jira authorization response did not include a refresh token.',
        },
        ipAddress,
      })
      throw new BadRequestException(
        'Jira authorization did not include an offline refresh token. Please reconnect Jira and approve offline access.',
      )
    }

    // ── Jira post-token resolution ──────────────────────────────────────────
    // After exchanging the code, resolve the Jira Cloud site id (cloudId) and
    // the user's Atlassian accountId.  Both are needed by JiraService later.
    if (connectorType === ConnectorType.JIRA) {
      try {
        const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/json',
          },
        })
        if (!resourcesRes.ok) {
          throw new BadRequestException(
            `Jira accessible-resources returned ${resourcesRes.status}`,
          )
        }
        const resources = (await resourcesRes.json()) as Array<{ id: string; name: string }>
        const cloudId = resources[0]?.id
        if (!cloudId) {
          throw new BadRequestException('No Jira Cloud sites accessible with these credentials.')
        }

        const myselfRes = await fetch(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
          {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              Accept: 'application/json',
            },
          },
        )
        if (!myselfRes.ok) {
          throw new BadRequestException(`Jira /myself returned ${myselfRes.status}`)
        }
        const myself = (await myselfRes.json()) as { accountId: string }

        tokens = { ...tokens, externalAccountId: cloudId, accountId: myself.accountId }
        this.logger.log(
          `Jira cloudId=${cloudId} accountId=${myself.accountId} resolved for user=${userId}`,
        )
      } catch (err: unknown) {
        this.audit.log('connector.connect.failed', {
          userId,
          connectorType,
          metadata: {
            outcome: 'failure',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          ipAddress,
        })
        throw err
      }
    }

    await this.credentials.storeCredential({
      userId,
      connectorType,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? '',
      scopes: tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes,
      externalAccountId: tokens.externalAccountId,
      expiresAt: tokens.expiresAt,
      accountId: tokens.accountId,
    })

    this.audit.log('connector.connect.completed', {
      userId,
      connectorType,
      metadata: { outcome: 'success', externalAccountId: tokens.externalAccountId },
      ipAddress,
    })

    this.logger.log(`OAuth callback success: user=${userId} connector=${connectorType}`)
    return { userId, connectorType }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(userId: string, type: ConnectorType, ipAddress?: string): Promise<void> {
    // Verify the credential exists before revoking so we can return 404
    try {
      await this.credentials.getMetadata(userId, type)
    } catch {
      throw new NotFoundException(`No active ${type} connector found for this user.`)
    }

    await this.credentials.revokeCredential(userId, type)

    this.audit.log('connector.disconnect', {
      userId,
      connectorType: type,
      metadata: { outcome: 'success' },
      ipAddress,
    })

    this.logger.log(`Disconnected: user=${userId} connector=${type}`)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getProviderConfig(type: ConnectorType): ProviderConfig {
    const apiBase = this.config.get<string>('API_BASE_URL') ?? 'http://localhost:3000/api/v1'

    if (type === ConnectorType.GMAIL) {
      const clientId = this.config.get<string>('GMAIL_CLIENT_ID')
      const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET')
      if (!clientId || !clientSecret) {
        throw new BadRequestException(
          'Gmail connector is not configured on this server. Contact your administrator.',
        )
      }
      return {
        clientId,
        clientSecret,
        redirectUri:
          this.config.get<string>('GMAIL_REDIRECT_URI') ?? `${apiBase}/connectors/gmail/callback`,
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/userinfo.email',
        ],
      }
    }

    if (type === ConnectorType.SLACK) {
      const clientId = this.config.get<string>('SLACK_CLIENT_ID')
      const clientSecret = this.config.get<string>('SLACK_CLIENT_SECRET')
      if (!clientId || !clientSecret) {
        throw new BadRequestException(
          'Slack connector is not configured on this server. Contact your administrator.',
        )
      }
      return {
        clientId,
        clientSecret,
        redirectUri:
          this.config.get<string>('SLACK_REDIRECT_URI') ?? `${apiBase}/connectors/slack/callback`,
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: [
          'im:read', 'mpim:read', 'channels:read', 'groups:read', 'users:read',
          'channels:history', 'groups:history', 'im:history', 'mpim:history',
          'chat:write', 'search:read',
        ],
      }
    }

    if (type === ConnectorType.JIRA) {
      const clientId = this.config.get<string>('JIRA_CLIENT_ID')
      const clientSecret = this.config.get<string>('JIRA_CLIENT_SECRET')
      if (!clientId || !clientSecret) {
        throw new BadRequestException(
          'Jira connector is not configured on this server. Contact your administrator.',
        )
      }
      return {
        clientId,
        clientSecret,
        redirectUri:
          this.config.get<string>('JIRA_REDIRECT_URI') ?? `${apiBase}/connectors/jira/callback`,
        authorizationUrl: 'https://auth.atlassian.com/authorize',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
      }
    }

    throw new BadRequestException(`Unknown connector type: ${String(type)}`)
  }

  private async exchangeCode(
    code: string,
    codeVerifier: string,
    provider: ProviderConfig,
    connectorType: ConnectorType,
  ): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scope?: string
    externalAccountId?: string
    accountId?: string
  }> {
    const body = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri,
      grant_type: 'authorization_code',
      code,
    })
    // Only include code_verifier for providers that support PKCE.
    // Slack OAuth v2 does not support PKCE and will reject the request if code_verifier is present.
    if (codeVerifier) {
      body.set('code_verifier', codeVerifier)
    }

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new BadRequestException(`Token exchange failed: ${errText}`)
    }

    const data = (await response.json()) as Record<string, unknown>

    // Slack OAuth v2: the user token lives in authed_user.access_token.
    // The top-level access_token is the bot token which does NOT have access to
    // per-user data (unread counts, DMs, etc.). Always prefer the user token for Slack.
    const authedUser = data['authed_user'] as Record<string, unknown> | undefined
    const accessToken =
      connectorType === ConnectorType.SLACK
        ? ((authedUser?.['access_token'] as string | undefined) ??
            (data['access_token'] as string | undefined))
        : ((data['access_token'] as string | undefined) ??
            (authedUser?.['access_token'] as string | undefined))
    if (!accessToken) {
      throw new BadRequestException('Token exchange response missing access_token')
    }

    return {
      accessToken,
      refreshToken: data['refresh_token'] as string | undefined,
      expiresAt:
        typeof data['expires_in'] === 'number'
          ? Math.floor(Date.now() / 1000) + (data['expires_in'] as number)
          : undefined,
      scope:
        (data['scope'] as string | undefined) ??
        (authedUser?.['scope'] as string | undefined),
      // Slack: authed_user.id  /  Gmail: email claim
      externalAccountId:
        (authedUser?.['id'] as string | undefined) ??
        (data['email'] as string | undefined),
    }
  }

  private storePendingState(state: string, input: PendingStateInput): void {
    const now = Date.now()
    // Prune stale entries
    for (const [k, v] of this.pendingStates) {
      if (v.expiresAt < now) this.pendingStates.delete(k)
    }
    this.pendingStates.set(state, { ...input, expiresAt: now + this.STATE_TTL_MS })
  }

  private consumePendingState(state: string): PendingState | null {
    const entry = this.pendingStates.get(state)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.pendingStates.delete(state)
      return null
    }
    this.pendingStates.delete(state) // single-use: consumed on first use
    return entry
  }

  private toFrontendType(type: ConnectorType): 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot' {
    if (type === ConnectorType.GMAIL) return 'gmail'
    if (type === ConnectorType.SLACK) return 'slack'
    if (type === ConnectorType.JIRA) return 'jira'
    // CALENDAR is no longer a standalone user-facing connector; credential lives under GMAIL
    if (type === ConnectorType.CLOCKIFY) return 'clockify'
    if (type === ConnectorType.HOTSPOT) return 'hotspot'
    return (type as string).toLowerCase() as 'gmail'
  }

  private toFrontendStatus(status: ConnectorStatus): ConnectorConnectionStatus {
    if (status === ConnectorStatus.ACTIVE) return 'connected'
    if (status === ConnectorStatus.REVOKED) return 'not_connected'
    if (status === ConnectorStatus.EXPIRED) return 'token_expired'
    if (status === ConnectorStatus.INVALID) return 'error'
    // Exhaustive fallback
    return 'error'
  }
}
