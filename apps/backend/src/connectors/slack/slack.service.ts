// In-memory short-term cache for Slack fetches
const slackCache: Record<string, { expires: number; value: any }> = {}
const SLACK_CACHE_TTL_MS = 60_000
const SLACK_CONVERSATIONS_LIST_CACHE_TTL_MS = 2 * 60_000
/**
 * SlackService
 *
 * Fetches unread DM + channel counts for a connected Slack user.
 *
 * Strategy (mirrors old version):
 *  - For each conversation the user is a member of:
 *    1. Get `last_read` from conversations.info
 *    2. Fetch conversations.history with oldest=last_read (limit 100)
 *    3. Count returned messages as unread
 *
 * Required scopes: im:read, mpim:read, channels:read, groups:read,
 *                  channels:history, groups:history, im:history, mpim:history,
 *                  chat:write (for sending thread replies)
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { ConnectorType } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
const SLACK_CONVERSATIONS_LIST = 'https://slack.com/api/conversations.list'
const SLACK_CONVERSATIONS_HISTORY = 'https://slack.com/api/conversations.history'
const SLACK_CONVERSATIONS_INFO = 'https://slack.com/api/conversations.info'
const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage'
const SLACK_CONVERSATIONS_MARK = 'https://slack.com/api/conversations.mark'
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'
const SLACK_USERS_INFO = 'https://slack.com/api/users.info'

function compareSlackTimestamps(left: string, right: string): number {
  const [leftSeconds, leftFraction = ''] = left.split('.')
  const [rightSeconds, rightFraction = ''] = right.split('.')
  const secondsComparison = leftSeconds.length === rightSeconds.length
    ? leftSeconds.localeCompare(rightSeconds)
    : leftSeconds.length - rightSeconds.length
  if (secondsComparison !== 0) return secondsComparison
  return leftFraction.padEnd(6, '0').localeCompare(rightFraction.padEnd(6, '0'))
}

export interface SlackUnreadResult {
  /** Unread DM count (im + mpim). */
  dms: number
  /** Unread channel messages (approximates mentions + all unread channel activity). */
  channels: number
  /** Combined total. */
  total: number
  /** External Slack user ID (if available). */
  externalAccountId?: string
}

export interface SlackScanMessage {
  channelId: string
  channelName: string
  ts: string
  userId: string
  userName: string
  text: string
  threadTs?: string
  mentionsCurrentUser?: boolean
  isUnread?: boolean
  resolution?: 'unresolved'
}

export interface SlackScanResult {
  channels: Array<{
    channelId: string
    channelName: string
    conversationType?: 'dm' | 'mpim' | 'channel'
    messages: SlackScanMessage[]
  }>
  answeredMessages: SlackAnsweredMessageRef[]
}

export interface SlackAnsweredMessageRef {
  channelId: string
  ts: string
}

export interface SlackSearchMessage {
  channelId: string
  channelName?: string
  text: string
  username?: string
  userId?: string
  timestamp: string
  permalink?: string
}

interface SlackConversation {
  id: string
  name?: string
  user?: string
  unread_count?: number
  unread_count_display?: number
  is_member?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_ext_shared?: boolean
  is_muted?: boolean
  last_read?: string
}

interface SlackFetchedMessage extends SlackScanMessage {
  replyUserIds: string[]
}

interface SlackFetchedChannel {
  channelId: string
  channelName: string
  messages: SlackFetchedMessage[]
  isDmOrMpim: boolean
  isDirectMessage: boolean
}

interface SlackInfoResponse {
  ok: boolean
  channel?: {
    id: string
    last_read?: string
    unread_count?: number
    unread_count_display?: number
  }
  error?: string
}

interface SlackHistoryResponse {
  ok: boolean
  messages?: Array<{ ts: string }>
  error?: string
  response_metadata?: { next_cursor?: string }
}


interface SlackListResponse {
  ok: boolean
  channels?: SlackConversation[]
  error?: string
  response_metadata?: { next_cursor?: string }
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name)

  /** Dedup map: accessToken → in-flight fetch promise */
  private readonly pendingFetches = new Map<string, Promise<SlackUnreadResult>>()
  constructor(
    private readonly credentials: ConnectorCredentialsService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  static clearCacheForTests(): void {
    for (const key of Object.keys(slackCache)) delete slackCache[key]
  }

  /**
   * Return the unread DM + channel count for the given user.
   *
   * @throws CredentialNotFoundException  when no Slack credential exists
   * @throws CredentialExpiredException   when the credential has expired
   * @throws CredentialInvalidException   when the credential has been revoked
   */
  async getUnreadCount(userId: string, forceRefresh = false): Promise<SlackUnreadResult> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.SLACK)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)

    let accessToken = tokens.accessToken

    // Proactively refresh if near expiry (only relevant when rotation is enabled)
    if (this.isNearExpiry(meta.tokenExpiresAt) && tokens.refreshToken) {
      this.logger.debug(`Slack token near expiry for user=${userId} – refreshing proactively`)
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.fetchUnreadCounts(accessToken, meta.externalAccountId ?? undefined, forceRefresh)
    } catch (err: unknown) {
      if (isSlackUnauthorized(err)) {
        this.logger.warn(`Slack auth error for user=${userId} – attempting token refresh`)
        if (tokens.refreshToken) {
          try {
            accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
            return await this.fetchUnreadCounts(accessToken, meta.externalAccountId ?? undefined, forceRefresh)
          } catch (refreshErr: unknown) {
            await this.credentials.markInvalid(userId, ConnectorType.SLACK)
            throw refreshErr
          }
        }
        await this.credentials.markInvalid(userId, ConnectorType.SLACK)
        throw err
      }
      throw err
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchUnreadCounts(
    accessToken: string,
    externalAccountId?: string,
    forceRefresh = false,
  ): Promise<SlackUnreadResult> {
    // Short-term cache by accessToken
    const cacheKey = `unread:${accessToken}`
    const now = Date.now()
    if (forceRefresh) {
      delete slackCache[cacheKey]
      delete slackCache[`list:${accessToken}:im,mpim`]
      delete slackCache[`list:${accessToken}:public_channel,private_channel`]
    }
    const cached = slackCache[cacheKey]
    if (cached && cached.expires > now) {
      this.logger.debug('Slack fetchUnreadCounts: returning cached result')
      return { ...cached.value, externalAccountId }
    }
    const existing = this.pendingFetches.get(accessToken)
    if (existing) {
      this.logger.debug('Slack fetch already in progress – deduplicating')
      const r = await existing
      return { ...r, externalAccountId }
    }
    const promise = this.doFetchUnreadCounts(accessToken).finally(() => {
      this.pendingFetches.delete(accessToken)
    })
    this.pendingFetches.set(accessToken, promise)
    const r = await promise
    slackCache[cacheKey] = { expires: now + SLACK_CACHE_TTL_MS, value: r }
    return { ...r, externalAccountId }
  }

  /**
   * Core fetch: list all member conversations, then call conversations.info
   * per conversation to get unread_count (user token with channels:read returns it).
   * Proactive 1300ms throttle between info calls (Tier 3 = 50 req/min).
   */
  private async doFetchUnreadCounts(accessToken: string): Promise<SlackUnreadResult> {
    // DMs: fast – conversations.list returns unread_count for im/mpim types
    const dmUnread = await this.countDmUnread(accessToken)

    // Channels: conversations.info per member channel (1 call / channel)
    const memberChannels = await this.getMemberChannels(accessToken)
    this.logger.debug(`Slack: ${memberChannels.length} member channels, DM unread messages=${dmUnread}`)

    const channelUnread = await this.countChannelUnread(accessToken, memberChannels)

    this.logger.debug(`Slack unread: channels=${channelUnread} dms=${dmUnread} total=${channelUnread + dmUnread}`)
    return { dms: dmUnread, channels: channelUnread, total: dmUnread + channelUnread }
  }

  /** Count unread DM/MPIM messages reported by Slack. */
  private async countDmUnread(accessToken: string): Promise<number> {
    const convos = await this.listConversations(accessToken, 'im,mpim')
    return convos.reduce(
      (total, conversation) =>
        total + (conversation.is_muted ? 0 : conversation.unread_count ?? conversation.unread_count_display ?? 0),
      0,
    )
  }

  /** Get channels the user is a member of. */
  private async getMemberChannels(accessToken: string): Promise<SlackConversation[]> {
    const convos = await this.listConversations(accessToken, 'public_channel,private_channel')
    return convos.filter((c) => c.is_member !== false)
  }

  /**
   * Count unread messages in each member channel.
   * `conversations.list` often includes the count; only fall back to the more
   * expensive `conversations.info` endpoint when Slack omitted it.
   */
  private async countChannelUnread(
    accessToken: string,
    channels: SlackConversation[],
  ): Promise<number> {
    let unread = 0
    for (const channel of channels) {
      const listedUnreadCount = channel.unread_count ?? channel.unread_count_display
      if (!channel.is_muted && listedUnreadCount !== undefined) {
        unread += listedUnreadCount
        continue
      }

      const channelId = channel.id
      const infoUrl = new URL(SLACK_CONVERSATIONS_INFO)
      infoUrl.searchParams.set('channel', channelId)

      try {
        const infoRes = await this.slackGet(infoUrl.toString(), accessToken)
        const infoData = (await infoRes.json()) as {
          ok: boolean
          channel?: {
            unread_count?: number
            unread_count_display?: number
            last_read?: string
            is_muted?: boolean
          }
          error?: string
        }

        if (infoData.ok && !infoData.channel?.is_muted) {
          const unreadCount = infoData.channel?.unread_count ?? infoData.channel?.unread_count_display

          if (unreadCount !== undefined) {
            unread += unreadCount
          } else {
            const lastRead = infoData.channel?.last_read
            if (lastRead && lastRead !== '0' && parseFloat(lastRead) > 0) {
              await new Promise((r) => setTimeout(r, 1_300))
              const histUrl = new URL(SLACK_CONVERSATIONS_HISTORY)
              histUrl.searchParams.set('channel', channelId)
              histUrl.searchParams.set('oldest', lastRead)
              histUrl.searchParams.set('limit', '1')
              const histRes = await this.slackGet(histUrl.toString(), accessToken)
              const histData = (await histRes.json()) as {
                ok: boolean
                messages?: Array<{ ts: string }>
              }
              if (histData.ok && (histData.messages?.length ?? 0) > 0) unread++
            }
          }
        } else {
          throw new Error(`Slack conversations.info error for channel ${channelId}: ${infoData.error ?? 'unknown error'}`)
        }
      } catch (err: unknown) {
        throw err
      }

      await new Promise((r) => setTimeout(r, 1_300))
    }
    return unread
  }

  /** Page through conversations.list for given types, returning all member conversations.
   *  Results are cached for 2 minutes per (accessToken, types) to reduce API calls.
   */
  private async listConversations(accessToken: string, types: string): Promise<SlackConversation[]> {
    const cacheKey = `list:${accessToken}:${types}`
    const now = Date.now()
    const cached = slackCache[cacheKey]
    if (cached && cached.expires > now) {
      this.logger.debug(`Slack listConversations(${types}): returning cached result`)
      return cached.value
    }
    const result: SlackConversation[] = []
    let cursor: string | undefined
    do {
      const url = new URL(SLACK_CONVERSATIONS_LIST)
      url.searchParams.set('types', types)
      url.searchParams.set('exclude_archived', 'true')
      url.searchParams.set('limit', '200')
      if (cursor) url.searchParams.set('cursor', cursor)

      let res: Response
      try {
        res = await this.slackGet(url.toString(), accessToken)
      } catch (error: unknown) {
        if (error instanceof SlackRateLimitError && cached) {
          this.logger.warn(`Slack conversations.list(${types}) rate-limited; returning stale cache`)
          return cached.value
        }
        throw error
      }
      const data = (await res.json()) as SlackListResponse
      if (!data.ok) {
        if (data.error === 'invalid_auth' || data.error === 'token_revoked') {
          throw new SlackUnauthorizedError(`Slack conversations.list (${types}) error: ${data.error}`)
        }
        throw new Error(`Slack conversations.list (${types}) error: ${data.error ?? 'unknown error'}`)
      }
      result.push(...(data.channels ?? []))
      cursor = data.response_metadata?.next_cursor
    } while (cursor)
    slackCache[cacheKey] = { expires: now + SLACK_CONVERSATIONS_LIST_CACHE_TTL_MS, value: result }
    return result
  }

  /**
   * Perform a GET request to a Slack API endpoint, honouring a single 429 retry.
   */
  /**
   * Enhanced logging: logs endpoint, method, and parallel call count.
   */
  private async slackGet(url: string, accessToken: string): Promise<Response> {
    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (res.status === 429) {
      const endpoint = new URL(url).pathname
      const retryAfter = Number(res.headers.get('Retry-After') ?? '5')
      const waitMs = Math.min(retryAfter * 1000, 15_000)
      this.logger.warn(`Slack rate-limited – waiting ${waitMs}ms (endpoint=${endpoint})`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
    }

    if (!res.ok) {
      if (res.status === 429) throw new SlackRateLimitError()
      throw new Error(`Slack API HTTP error ${res.status}`)
    }
    return res
  }

  /**
   * Exchange refresh token for a new access token (Slack token rotation).
   * Only applicable when Slack token rotation is enabled in the app.
   */
  async refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('SLACK_CLIENT_ID')
    const clientSecret = this.config.get<string>('SLACK_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw new Error('Slack client credentials not configured')
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    const response = await fetch(SLACK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errText = await response.text()
      this.logger.error(`Slack token refresh failed for user=${userId}: ${errText}`)
      await this.credentials.markInvalid(userId, ConnectorType.SLACK)
      throw new Error(`Slack token refresh failed: ${errText}`)
    }

    const data = (await response.json()) as {
      ok: boolean
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }

    if (!data.ok || !data.access_token) {
      this.logger.error(`Slack token refresh error for user=${userId}: ${data.error}`)
      await this.credentials.markInvalid(userId, ConnectorType.SLACK)
      throw new Error(`Slack token refresh error: ${data.error}`)
    }

    const newAccessToken = data.access_token
    const newRefreshToken = data.refresh_token ?? refreshToken
    const expiresAt = data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined

    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)
    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.SLACK,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      scopes: meta.scopes,
      externalAccountId: meta.externalAccountId ?? undefined,
      expiresAt,
    })

    this.logger.log(`Slack access token refreshed for user=${userId}`)
    return newAccessToken
  }

  private isNearExpiry(tokenExpiresAt: Date | null): boolean {
    if (!tokenExpiresAt) return false
    const fiveMinutesMs = 5 * 60 * 1000
    return tokenExpiresAt.getTime() - Date.now() < fiveMinutesMs
  }

  /**
   * Fetch recent unread messages from channels and DMs for the scan agent.
   * Returns up to 20 messages per channel with unreads.
   */
  async fetchScanMessages(
    userId: string,
    includeAnswered = false,
    forceRefresh = false,
  ): Promise<SlackScanResult> {
    // Short-term cache by userId
    const cacheKey = `scan:${userId}:${includeAnswered ? 'preview' : 'scan'}`
    const now = Date.now()
    const cached = slackCache[cacheKey]
    if (!forceRefresh && cached && cached.expires > now) {
      this.logger.debug('Slack fetchScanMessages: returning cached result')
      return cached.value
    }
    const tokens = await this.credentials.getTokens(userId, ConnectorType.SLACK)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)
    const readCursors = includeAnswered
      ? new Map(
        (await this.prisma.slackReadCursor.findMany({
          where: { userId },
          select: { channelId: true, timestamp: true },
        })).map((cursor) => [cursor.channelId, cursor.timestamp]),
      )
      : new Map<string, string>()

    if (forceRefresh) {
      delete slackCache[`list:${accessToken}:im,mpim`]
      delete slackCache[`list:${accessToken}:public_channel,private_channel`]
    }

    if (this.isNearExpiry(meta.tokenExpiresAt) && tokens.refreshToken) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      const result = await this.doFetchScanMessages(
        accessToken,
        meta.externalAccountId ?? undefined,
        includeAnswered,
        readCursors,
      )
      slackCache[cacheKey] = { expires: now + SLACK_CACHE_TTL_MS, value: result }
      return result
    } catch (err: unknown) {
      if (err instanceof SlackRateLimitError && cached) {
        this.logger.warn(`Slack preview rate-limited for user=${userId}; returning stale cache`)
        return cached.value
      }
      if (isSlackUnauthorized(err) && tokens.refreshToken) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        const result = await this.doFetchScanMessages(
          accessToken,
          meta.externalAccountId ?? undefined,
          includeAnswered,
          readCursors,
        )
        slackCache[cacheKey] = { expires: now + SLACK_CACHE_TTL_MS, value: result }
        return result
      }
      throw err
    }
  }

  /**
   * Search all Slack messages (including read) matching the query.
   * Requires search:read scope. Returns [] with a warning if scope is missing.
   */
  async searchMessages(userId: string, query: string, maxResults = 20): Promise<SlackSearchMessage[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.SLACK)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)

    if (this.isNearExpiry(meta.tokenExpiresAt) && tokens.refreshToken) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.doSearchMessages(accessToken, query, maxResults)
    } catch (err: unknown) {
      if (isSlackUnauthorized(err) && tokens.refreshToken) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doSearchMessages(accessToken, query, maxResults)
      }
      throw err
    }
  }

  private async doSearchMessages(accessToken: string, query: string, maxResults: number): Promise<SlackSearchMessage[]> {
    const url = new URL('https://slack.com/api/search.messages')
    url.searchParams.set('query', query)
    url.searchParams.set('count', String(maxResults))
    url.searchParams.set('sort', 'timestamp')
    url.searchParams.set('sort_dir', 'desc')

    const res = await this.slackGet(url.toString(), accessToken)
    const data = (await res.json()) as {
      ok: boolean
      error?: string
      messages?: {
        matches?: Array<{
          channel?: { id?: string; name?: string }
          user?: string
          username?: string
          text?: string
          ts?: string
          permalink?: string
        }>
      }
    }

    if (!data.ok) {
      if (data.error === 'missing_scope' || data.error === 'not_allowed_token_type') {
        this.logger.warn(`Slack search missing scope for user — search:read required. Re-authorize Slack connector.`)
        return []
      }
      throw new Error(`Slack search.messages error: ${data.error}`)
    }

    return (data.messages?.matches ?? []).map((m) => ({
      channelId: m.channel?.id ?? '',
      channelName: m.channel?.name,
      text: m.text ?? '',
      username: m.username,
      userId: m.user,
      timestamp: m.ts ?? '',
      permalink: m.permalink,
    }))
  }

  private async doFetchScanMessages(
    accessToken: string,
    externalAccountId?: string,
    includeAnswered = false,
    readCursors = new Map<string, string>(),
  ): Promise<SlackScanResult> {
    // ── 1. DMs / MPIMs ──
    // Slack's unread_count is always 0 via the API token, so we detect new messages
    // by checking conversations.history since last_read (or 24h if last_read is absent).
    // IDs are roughly chronological, so sorting descending puts newest DMs first.
    const dmConvosPromise = this.listConversations(accessToken, 'im,mpim')
    const channelConvosPromise = this.listConversations(accessToken, 'public_channel,private_channel')
    const dmConvos = await dmConvosPromise
    const MAX_SCAN_DMS = Number(
      includeAnswered
        ? process.env.SLACK_PREVIEW_MAX_DMS ?? 8
        : process.env.SLACK_MAX_SCAN_DMS ?? 50,
    )
    const cutoff24h = String((Date.now() / 1000) - 86_400)

    const dmCandidates = dmConvos
      .filter((c) => !c.is_muted && c.is_member !== false)
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, MAX_SCAN_DMS)

    const unreadDms: SlackConversation[] = []
    if (!includeAnswered) {
      for (const c of dmCandidates) {
        const reportedUnreadCount = c.unread_count ?? c.unread_count_display
        if (reportedUnreadCount !== undefined && reportedUnreadCount > 0) {
          unreadDms.push(c)
          continue
        }
        const oldest = (c.last_read && c.last_read !== '0000000000.000000') ? c.last_read : cutoff24h
        try {
          const histUrl = new URL(SLACK_CONVERSATIONS_HISTORY)
          histUrl.searchParams.set('channel', c.id)
          histUrl.searchParams.set('oldest', oldest)
          histUrl.searchParams.set('limit', '1')
          const histRes = await this.slackGet(histUrl.toString(), accessToken)
          const histData = (await histRes.json()) as { ok: boolean; messages?: Array<{ ts: string }> }
          if (histData.ok && (histData.messages?.length ?? 0) > 0) unreadDms.push(c)
        } catch {
          // skip on error
        }
      }
    }
    this.logger.debug(`Slack: ${unreadDms.length} unread DMs from ${dmCandidates.length} checked`)
    const visibleDms = includeAnswered ? dmCandidates : unreadDms

    // ── 2. Channels – use conversations.info per channel (same as getUnreadCount) ──
    // Cap at MAX_SCAN_CHANNELS to avoid excessive rate-limit delays during scan.
    const MAX_SCAN_CHANNELS = Number(
      includeAnswered
        ? process.env.SLACK_PREVIEW_MAX_CHANNELS ?? 12
        : process.env.SLACK_MAX_SCAN_CHANNELS ?? 15,
    )
    const channelConvos = await channelConvosPromise
    const memberChannels = channelConvos
      .filter((c) => c.is_member !== false)
      .slice(0, MAX_SCAN_CHANNELS)

    const unreadChannelIds: string[] = []
    const channelLastRead = new Map<string, string>()
    const channelUnreadCounts = new Map<string, number>()
    const loadChannelState = async (ch: SlackConversation): Promise<{
      channelId: string
      lastRead?: string
      unreadCount?: number
      isUnread: boolean
    } | null> => {
      const listedUnreadCount = ch.unread_count ?? ch.unread_count_display
      if (includeAnswered && (ch.last_read || listedUnreadCount !== undefined)) {
        return {
          channelId: ch.id,
          lastRead: ch.last_read,
          unreadCount: listedUnreadCount,
          isUnread: (listedUnreadCount ?? 0) > 0,
        }
      }
      try {
        const infoUrl = new URL(SLACK_CONVERSATIONS_INFO)
        infoUrl.searchParams.set('channel', ch.id)
        const infoRes = await this.slackGet(infoUrl.toString(), accessToken)
        const infoData = (await infoRes.json()) as {
          ok: boolean
          channel?: { unread_count?: number; unread_count_display?: number; is_muted?: boolean; last_read?: string }
        }
        if (!infoData.ok || infoData.channel?.is_muted) return null
        const lastRead = infoData.channel?.last_read ?? ch.last_read

        const unreadCount = infoData.channel?.unread_count ?? infoData.channel?.unread_count_display
          ?? ch.unread_count ?? ch.unread_count_display
        if (unreadCount !== undefined) {
          return { channelId: ch.id, lastRead, unreadCount, isUnread: unreadCount > 0 }
        } else if (!includeAnswered) {
          // Fallback: check history since last_read
          if (lastRead && lastRead !== '0' && parseFloat(lastRead) > 0) {
            await new Promise((r) => setTimeout(r, 1_300))
            const histUrl = new URL(SLACK_CONVERSATIONS_HISTORY)
            histUrl.searchParams.set('channel', ch.id)
            histUrl.searchParams.set('oldest', lastRead)
            histUrl.searchParams.set('limit', '1')
            const histRes = await this.slackGet(histUrl.toString(), accessToken)
            const histData = (await histRes.json()) as { ok: boolean; messages?: Array<{ ts: string }> }
            return {
              channelId: ch.id,
              lastRead,
              isUnread: histData.ok && (histData.messages?.length ?? 0) > 0,
            }
          }
        }
        return { channelId: ch.id, lastRead, isUnread: false }
      } catch {
        return null
      }
    }
    const channelStates = includeAnswered
      ? await Promise.all(memberChannels.map(loadChannelState))
      : await memberChannels.reduce<Promise<Array<Awaited<ReturnType<typeof loadChannelState>>>>>(
        async (pending, channel) => {
          const states = await pending
          states.push(await loadChannelState(channel))
          await new Promise((resolve) => setTimeout(resolve, 500))
          return states
        },
        Promise.resolve([]),
      )
    for (const state of channelStates) {
      if (!state) continue
      if (state.lastRead) channelLastRead.set(state.channelId, state.lastRead)
      if (state.unreadCount !== undefined) channelUnreadCounts.set(state.channelId, state.unreadCount)
      if (state.isUnread) unreadChannelIds.push(state.channelId)
    }

    // ── 3. Resolve human-readable names ──
    // Channel names from conversations.list response
    const channelNames = new Map<string, string>()
    for (const ch of channelConvos) {
      if (ch.name) channelNames.set(ch.id, ch.name)
    }

    // DM names: resolve other user's display name via users.info
    const dmNames = new Map<string, string>()
    await Promise.all(visibleDms.map(async (conversation) => {
      if (!conversation.user) return
      const displayName = await this.resolveUserName(accessToken, conversation.user)
      dmNames.set(conversation.id, displayName)
    }))

    // ── 4. Fetch messages for all unread conversations ──
    const visibleChannelIds = includeAnswered
      ? memberChannels.map((channel) => channel.id)
      : unreadChannelIds
    const allUnreadIds = [
      ...visibleDms.map((c) => ({
        id: c.id,
        name: dmNames.get(c.id) ?? c.id,
        isDm: true,
        lastRead: c.last_read,
        unreadCount: c.unread_count ?? c.unread_count_display,
      })),
      ...visibleChannelIds.map((id) => ({
        id,
        name: channelNames.get(id) ?? id,
        isDm: false,
        lastRead: channelLastRead.get(id),
        unreadCount: channelUnreadCounts.get(id),
      })),
    ]

    if (allUnreadIds.length === 0) return { channels: [], answeredMessages: [] }

    const channelResults = await Promise.all(
      allUnreadIds.map((c) => this.fetchChannelMessages(
        accessToken,
        c.id,
        c.name,
        includeAnswered ? 5 : 20,
      ).then((result) => ({
        ...result,
        messages: result.messages.map((message) => {
          const localReadTimestamp = readCursors.get(c.id)
          const readLocally = localReadTimestamp !== undefined
            && compareSlackTimestamps(message.ts, localReadTimestamp) <= 0
          return {
            ...message,
            isUnread: !readLocally && (c.unreadCount === 0
              ? false
              : !c.lastRead || compareSlackTimestamps(message.ts, c.lastRead) > 0),
          }
        }),
        isDmOrMpim: c.isDm,
        isDirectMessage: c.isDm && dmConvos.some((conversation) => conversation.id === c.id && conversation.is_im),
      }))),
    )
    const { channels: filteredChannelResults, answeredMessages } =
      this.filterAnsweredMessages(channelResults, externalAccountId)
    const visibleChannelResults = includeAnswered
      ? this.excludeOwnMessages(channelResults, externalAccountId)
      : filteredChannelResults

    // Partition results: required = DMs + channels with mention of user; optional = other channels
    const extraLimit = Number(process.env.SLACK_SCAN_EXTRA_MESSAGES ?? 50)
    const mentionTag = externalAccountId ? `<@${externalAccountId}>` : null

    const required: SlackFetchedChannel[] = []
    const optional: SlackFetchedChannel[] = []

    for (const res of visibleChannelResults) {
      if (res.isDmOrMpim) {
        required.push(res)
        continue
      }
      // detect mention in any message
      let hasMention = false
      if (mentionTag) {
        for (const m of res.messages) {
          if (m.text && m.text.includes(mentionTag)) { hasMention = true; break }
        }
      }
      if (hasMention) required.push(res)
      else optional.push(res)
    }

    // Include optional channels up to extraLimit messages total (preserve order)
    const includedOptional: typeof optional = []
    let optionalCount = 0
    for (const ch of optional) {
      const chCount = ch.messages.length
      if (optionalCount + chCount <= extraLimit) {
        includedOptional.push(ch)
        optionalCount += chCount
      } else if (optionalCount < extraLimit) {
        // include partial messages for this channel up to remaining budget
        const allowed = extraLimit - optionalCount
        includedOptional.push({ ...ch, messages: ch.messages.slice(0, allowed) })
        optionalCount = extraLimit
        break
      } else {
        break
      }
    }

    const final = [...required, ...includedOptional].map((channel) => ({
      channelId: channel.channelId,
      channelName: channel.channelName,
      conversationType: channel.isDirectMessage
        ? 'dm' as const
        : channel.isDmOrMpim
          ? 'mpim' as const
          : 'channel' as const,
      messages: channel.messages.map((message) => ({
        ...message,
        mentionsCurrentUser: mentionTag ? message.text.includes(mentionTag) : false,
        resolution: 'unresolved' as const,
      })),
    }))
    return { channels: final, answeredMessages }
  }

  private excludeOwnMessages(
    channels: SlackFetchedChannel[],
    externalAccountId?: string,
  ): SlackFetchedChannel[] {
    if (!externalAccountId) return channels
    return channels
      .map((channel) => ({
        ...channel,
        messages: channel.messages.filter((message) => message.userId !== externalAccountId),
      }))
      .filter((channel) => channel.messages.length > 0)
  }

  private filterAnsweredMessages(
    channels: SlackFetchedChannel[],
    externalAccountId?: string,
  ): { channels: SlackFetchedChannel[]; answeredMessages: SlackAnsweredMessageRef[] } {
    if (!externalAccountId) return { channels, answeredMessages: [] }

    const answeredMessages = new Map<string, SlackAnsweredMessageRef>()
    const filteredChannels = channels
      .map((channel) => {
        const ownMessageTimestamps = channel.isDirectMessage
          ? channel.messages
            .filter((message) => message.userId === externalAccountId)
            .map((message) => message.ts)
          : []

        const messages = channel.messages.filter((message) => {
          if (message.userId === externalAccountId) return false

          const answeredInThread = message.replyUserIds.includes(externalAccountId)
          const answeredInDirectMessage = ownMessageTimestamps.some(
            (ownTimestamp) => compareSlackTimestamps(ownTimestamp, message.ts) > 0,
          )
          if (!answeredInThread && !answeredInDirectMessage) return true

          const ref = { channelId: channel.channelId, ts: message.ts }
          answeredMessages.set(`${ref.channelId}:${ref.ts}`, ref)
          return false
        })

        return { ...channel, messages }
      })
      .filter((channel) => channel.messages.length > 0)

    return { channels: filteredChannels, answeredMessages: [...answeredMessages.values()] }
  }

  // ─── Reply actions ────────────────────────────────────────────────────────────

  /** Post a reply into a Slack thread. */
  async sendThreadReply(
    userId: string,
    opts: { channelId: string; threadTs: string; text: string },
  ): Promise<void> {
    const accessToken = await this.getValidAccessToken(userId)
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: opts.channelId,
        text: opts.text,
        thread_ts: opts.threadTs,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Slack sendThreadReply HTTP error ${res.status}: ${text}`)
    }
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      throw new Error(`Slack sendThreadReply failed: ${data.error}`)
    }
    delete slackCache[`scan:${userId}:scan`]
    delete slackCache[`scan:${userId}:preview`]
  }

  /** Mark a Slack channel as read up to (and including) the given message timestamp. */
  async markMessageAsRead(userId: string, channelId: string, ts: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(userId)
    const res = await fetch(SLACK_CONVERSATIONS_MARK, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, ts }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Slack markMessageAsRead HTTP error ${res.status}: ${text}`)
    }
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      throw new Error(`Slack markMessageAsRead failed: ${data.error}`)
    }
    const currentCursor = await this.prisma.slackReadCursor.findUnique({
      where: { userId_channelId: { userId, channelId } },
      select: { timestamp: true },
    })
    if (!currentCursor || compareSlackTimestamps(ts, currentCursor.timestamp) > 0) {
      await this.prisma.slackReadCursor.upsert({
        where: { userId_channelId: { userId, channelId } },
        create: { userId, channelId, timestamp: ts },
        update: { timestamp: ts },
      })
    }
    delete slackCache[`scan:${userId}:scan`]
    delete slackCache[`scan:${userId}:preview`]
  }

  /**
   * Fetch messages sent by the user on the given date (YYYY-MM-DD).
   * Uses search.messages with `from:<@USER_ID> on:DATE`.
   * Returns [] gracefully when search:read scope is missing.
   */
  async fetchSentMessagesForDay(userId: string, date: string): Promise<SlackSearchMessage[]> {
    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)
    const slackUserId = meta.externalAccountId
    if (!slackUserId) return []
    return this.searchMessages(userId, `from:<@${slackUserId}> on:${date}`, 30)
  }

  /** Return a valid (fresh if needed) access token for the given user. */
  private async getValidAccessToken(userId: string): Promise<string> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.SLACK)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.SLACK)
    if (this.isNearExpiry(meta.tokenExpiresAt) && tokens.refreshToken) {
      return this.refreshAccessToken(userId, tokens.refreshToken)
    }
    return tokens.accessToken
  }

  // ─── Scan fetch helpers ───────────────────────────────────────────────────────

  private async fetchChannelMessages(
    accessToken: string,
    channelId: string,
    channelName: string,
    limit = 20,
  ): Promise<{ channelId: string; channelName: string; messages: SlackFetchedMessage[] }> {
    try {
      const url = new URL(SLACK_CONVERSATIONS_HISTORY)
      url.searchParams.set('channel', channelId)
      url.searchParams.set('limit', String(limit))

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (!res.ok) return { channelId, channelName, messages: [] }

      const data = (await res.json()) as {
        ok: boolean
        messages?: Array<{
          ts: string
          user?: string
          text?: string
          thread_ts?: string
          reply_users?: string[]
        }>
      }
      if (!data.ok) return { channelId, channelName, messages: [] }

      // Resolve unique user IDs to display names
      const uniqueUserIds = [...new Set((data.messages ?? []).map((m) => m.user).filter(Boolean) as string[])]
      const userNames = new Map<string, string>()
      await Promise.all(
        uniqueUserIds.map(async (uid) => {
          userNames.set(uid, await this.resolveUserName(accessToken, uid))
        }),
      )

      const messages: SlackFetchedMessage[] = (data.messages ?? []).map((m) => ({
        channelId,
        channelName,
        ts: m.ts,
        userId: m.user ?? '',
        userName: m.user ? (userNames.get(m.user) ?? m.user) : '',
        text: m.text ?? '',
        threadTs: m.thread_ts,
        replyUserIds: m.reply_users ?? [],
      }))

      return { channelId, channelName, messages }
    } catch {
      return { channelId, channelName, messages: [] }
    }
  }

  private async resolveUserName(accessToken: string, userId: string): Promise<string> {
    const cacheKey = `user-name:${accessToken}:${userId}`
    const cached = slackCache[cacheKey]
    if (cached && cached.expires > Date.now()) return cached.value as string
    try {
      const url = new URL(SLACK_USERS_INFO)
      url.searchParams.set('user', userId)
      const res = await this.slackGet(url.toString(), accessToken)
      const data = (await res.json()) as {
        ok: boolean
        user?: { profile?: { display_name?: string; real_name?: string } }
      }
      if (data.ok && data.user?.profile) {
        const name = data.user.profile.display_name || data.user.profile.real_name || userId
        slackCache[cacheKey] = {
          expires: Date.now() + SLACK_CONVERSATIONS_LIST_CACHE_TTL_MS,
          value: name,
        }
        return name
      }
    } catch {
      // fall through to userId
    }
    return userId
  }
}

// ─── Local error type ─────────────────────────────────────────────────────────

export class SlackUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackUnauthorizedError'
  }
}

class SlackRateLimitError extends Error {
  constructor() {
    super('Slack API rate limit exceeded')
    this.name = 'SlackRateLimitError'
  }
}

function isSlackUnauthorized(err: unknown): err is SlackUnauthorizedError {
  return err instanceof SlackUnauthorizedError
}
