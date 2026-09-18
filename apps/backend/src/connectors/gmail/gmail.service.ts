/**
 * GmailService
 *
 * Gmail connector: unread count, scan emails, and reply actions.
 *
 * Features:
 *  - Proactive access-token refresh; reactive refresh on 401/403.
 *  - On persistent 401 the credential is marked INVALID in DB.
 *  - Never exposes token values outside this service.
 *
 * Required OAuth scopes:
 *  - https://www.googleapis.com/auth/gmail.readonly  (read)
 *  - https://www.googleapis.com/auth/gmail.send      (send reply)
 *  - https://www.googleapis.com/auth/gmail.modify    (mark as read)
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ConnectorCredentialsService } from '../connector-credentials.service'
import { ConnectorType } from '@prisma/client'
import {
  parseGoogleDocsCommentNotification,
  type GoogleDocsCommentNotification,
} from './google-docs-notification'

const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads'
const GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface GmailUnreadResult {
  /** Unread inbox thread count (estimate from Gmail API). */
  unreadCount: number
  /** External Gmail address (if available from the credential record). */
  externalAccountId?: string
}

export interface GmailScanEmail {
  messageId: string
  threadId?: string
  subject: string
  from: string
  to: string
  cc: string
  recipientRole: 'to' | 'cc' | 'other' | 'unknown'
  resolution?: 'answered' | 'unresolved' | 'unknown'
  threadContext?: string
  snippet: string
  body: string
  receivedAt: string // ISO 8601
  labels: string[]
  googleDocsComment?: GoogleDocsCommentNotification
}

export interface GmailMessageDetails {
  messageId: string
  threadId: string
  /** RFC 2822 Message-ID header value – used for In-Reply-To / References */
  rfcMessageId: string
  from: string
  to: string
  cc: string
  subject: string
}

export interface GmailThreadActivity {
  resolution: 'answered' | 'unresolved'
  context: string
}

type GmailPayload = {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPayload[]
}

function extractTextBody(payload: GmailPayload | undefined): string | null {
  if (!payload) return null
  const plainText = findMimeBody(payload, 'text/plain')
  if (plainText) return plainText.slice(0, 2000)
  const html = findMimeBody(payload, 'text/html')
  return html ? htmlToText(html).slice(0, 2000) : null
}

function findMimeBody(payload: GmailPayload, mimeType: string): string | null {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }
  for (const part of payload.parts ?? []) {
    const body = findMimeBody(part, mimeType)
    if (body) return body
  }
  return null
}

function htmlToText(html: string): string {
  const withLinks = html.replace(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
    ' $1 ',
  )
  return decodeHtmlEntities(withLinks)
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return named[code.toLowerCase()] ?? entity
  })
}

function isSameEmailAddress(from: string, externalAccountId?: string): boolean {
  if (!externalAccountId) return false
  const angleBracketMatch = from.match(/<([^<>]+)>/)
  const sender = (angleBracketMatch?.[1] ?? from).trim().toLowerCase()
  return sender === externalAccountId.trim().toLowerCase()
}

function recipientRole(
  to: string,
  cc: string,
  externalAccountId?: string,
): GmailScanEmail['recipientRole'] {
  if (!externalAccountId) return 'unknown'

  const address = externalAccountId.trim().toLowerCase()
  const includesAddress = (header: string) =>
    header
      .split(',')
      .map((entry) => entry.match(/<([^<>]+)>/)?.[1] ?? entry)
      .some((entry) => entry.trim().toLowerCase() === address)

  if (includesAddress(to)) return 'to'
  if (includesAddress(cc)) return 'cc'
  return 'other'
}

function decodeRfc2047Header(value: string): string {
  return value.replace(/=\?utf-?8\?B\?([^?]*)\?=/gi, (_match, encoded: string) =>
    Buffer.from(encoded, 'base64').toString('utf8'),
  )
}

function encodeRfc2047Header(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name)

  constructor(
    private readonly credentials: ConnectorCredentialsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Return the unread inbox thread count for the given user.
   *
   * @throws CredentialNotFoundException  when no Gmail credential exists
   * @throws CredentialExpiredException   when the credential has expired and refresh fails
   * @throws CredentialInvalidException   when the credential has been revoked/invalidated
   */
  async getUnreadCount(userId: string): Promise<GmailUnreadResult> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    let accessToken = tokens.accessToken

    // Proactively refresh if the token is close to expiry (within 5 minutes)
    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      this.logger.debug(`Gmail token near expiry for user=${userId} – refreshing proactively`)
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      const count = await this.fetchUnreadCount(accessToken)
      return { unreadCount: count, externalAccountId: meta.externalAccountId ?? undefined }
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        this.logger.warn(`Gmail 401 for user=${userId} – attempting token refresh`)
        try {
          accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
          const count = await this.fetchUnreadCount(accessToken)
          return { unreadCount: count, externalAccountId: meta.externalAccountId ?? undefined }
        } catch (refreshErr: unknown) {
          await this.credentials.markInvalid(userId, ConnectorType.GMAIL)
          throw refreshErr
        }
      }
      throw err
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchUnreadCount(accessToken: string): Promise<number> {
    const url = new URL(GMAIL_THREADS_URL)
    url.searchParams.set('q', 'in:inbox is:unread')
    url.searchParams.set('maxResults', '500')

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 401 || response.status === 403) {
      throw new GmailUnauthorizedError(`Gmail API returned ${response.status}`)
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Gmail API error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as {
      resultSizeEstimate?: number
      threads?: unknown[]
    }

    // Use resultSizeEstimate if no threads array returned (empty inbox = 0)
    return data.resultSizeEstimate ?? data.threads?.length ?? 0
  }

  /**
   * Exchange refresh token for a new access token.
   * Updates the stored credential with the new access token + expiry.
   * On failure, marks the credential INVALID.
   */
  async refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID')
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw new Error('Gmail client credentials not configured')
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errText = await response.text()
      this.logger.error(`Gmail token refresh failed for user=${userId}: ${errText}`)
      await this.credentials.markInvalid(userId, ConnectorType.GMAIL)
      throw new Error(`Gmail token refresh failed: ${errText}`)
    }

    const data = (await response.json()) as {
      access_token: string
      expires_in?: number
    }

    const newAccessToken = data.access_token
    const expiresAt = data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined

    // Re-store the credential with the new access token (refresh token is unchanged)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)
    await this.credentials.storeCredential({
      userId,
      connectorType: ConnectorType.GMAIL,
      accessToken: newAccessToken,
      refreshToken, // unchanged
      scopes: meta.scopes,
      externalAccountId: meta.externalAccountId ?? undefined,
      expiresAt,
    })

    this.logger.log(`Gmail access token refreshed for user=${userId}`)
    return newAccessToken
  }

  private isNearExpiry(tokenExpiresAt: Date | null): boolean {
    if (!tokenExpiresAt) return false
    const fiveMinutesMs = 5 * 60 * 1000
    return tokenExpiresAt.getTime() - Date.now() < fiveMinutesMs
  }

  /**
   * Fetch emails sent by the user on the given date (YYYY-MM-DD).
   * Uses the Gmail SENT label with date-range filters.
   */
  async fetchSentEmailsForDay(userId: string, date: string): Promise<GmailScanEmail[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.doFetchSentEmailsForDay(accessToken, date)
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doFetchSentEmailsForDay(accessToken, date)
      }
      throw err
    }
  }

  private async doFetchSentEmailsForDay(accessToken: string, date: string): Promise<GmailScanEmail[]> {
    // Gmail date filters use YYYY/MM/DD; convert from YYYY-MM-DD
    const [y, m, d] = date.split('-')
    const afterDate = `${y}/${m}/${d}`
    const nextDay = new Date(Number(y), Number(m) - 1, Number(d) + 1)
    const beforeDate = `${nextDay.getFullYear()}/${String(nextDay.getMonth() + 1).padStart(2, '0')}/${String(nextDay.getDate()).padStart(2, '0')}`

    return this.doSearchEmails(accessToken, `in:sent after:${afterDate} before:${beforeDate}`, 20)
  }

  /**
   * Search all emails (including read) matching the given keywords.
   * Used by the task pipeline to find project-relevant messages regardless of read status.
   */
  async searchEmails(userId: string, keywords: string[], maxResults = 20): Promise<GmailScanEmail[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    const query = keywords.join(' OR ')
    try {
      return await this.doSearchEmails(accessToken, query, maxResults)
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doSearchEmails(accessToken, query, maxResults)
      }
      throw err
    }
  }

  private async doSearchEmails(accessToken: string, query: string, maxResults: number): Promise<GmailScanEmail[]> {
    const listUrl = new URL(GMAIL_MESSAGES_URL)
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('maxResults', String(maxResults))

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (listRes.status === 401 || listRes.status === 403) {
      throw new GmailUnauthorizedError(`Gmail API returned ${listRes.status}`)
    }
    if (!listRes.ok) throw new Error(`Gmail API error ${listRes.status}`)

    const listData = (await listRes.json()) as { messages?: Array<{ id: string }> }
    const ids = (listData.messages ?? []).map((m) => m.id)
    if (ids.length === 0) return []

    const emails = await Promise.all(ids.map((id) => this.fetchEmailMeta(accessToken, id)))
    return emails.filter((e): e is GmailScanEmail => e !== null)
  }

  /**
   * Fetch up to `maxResults` unread inbox emails for the scan agent.
   * Returns lightweight email objects (no full body) suitable for LLM classification.
   */
  async fetchScanEmails(userId: string, maxResults = 30): Promise<GmailScanEmail[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)
    const externalAccountId = meta.externalAccountId ?? undefined

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.doFetchScanEmails(accessToken, maxResults, externalAccountId)
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doFetchScanEmails(accessToken, maxResults, externalAccountId)
      }
      throw err
    }
  }

  /** Fetch recent inbox emails for the read-only source preview. */
  async fetchPreviewEmails(userId: string, maxResults = 30): Promise<GmailScanEmail[]> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)
    const externalAccountId = meta.externalAccountId ?? undefined

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.doFetchEmails(
        accessToken,
        maxResults,
        externalAccountId,
        'in:inbox -in:spam -in:trash -from:me',
      )
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doFetchEmails(
          accessToken,
          maxResults,
          externalAccountId,
          'in:inbox -in:spam -in:trash -from:me',
        )
      }
      throw err
    }
  }

  async getThreadActivity(
    userId: string,
    threadId: string,
    occurredAt: string,
  ): Promise<GmailThreadActivity> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    let accessToken = tokens.accessToken
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)

    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
    }

    try {
      return await this.doGetThreadActivity(accessToken, threadId, occurredAt)
    } catch (err: unknown) {
      if (isHttpUnauthorized(err)) {
        accessToken = await this.refreshAccessToken(userId, tokens.refreshToken)
        return await this.doGetThreadActivity(accessToken, threadId, occurredAt)
      }
      throw err
    }
  }

  private async doFetchScanEmails(
    accessToken: string,
    maxResults: number,
    externalAccountId?: string,
  ): Promise<GmailScanEmail[]> {
    return this.doFetchEmails(
      accessToken,
      maxResults,
      externalAccountId,
      'is:unread -in:spam -in:trash -from:me',
    )
  }

  private async doFetchEmails(
    accessToken: string,
    maxResults: number,
    externalAccountId: string | undefined,
    query: string,
  ): Promise<GmailScanEmail[]> {
    const listUrl = new URL(GMAIL_MESSAGES_URL)
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('maxResults', String(maxResults))

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (listRes.status === 401 || listRes.status === 403) {
      throw new GmailUnauthorizedError(`Gmail API returned ${listRes.status}`)
    }
    if (!listRes.ok) throw new Error(`Gmail API error ${listRes.status}`)

    const listData = (await listRes.json()) as { messages?: Array<{ id: string }> }
    const ids = (listData.messages ?? []).map((m) => m.id)
    if (ids.length === 0) return []

    const emails = await Promise.all(
      ids.map((id) => this.fetchEmailMeta(accessToken, id, externalAccountId)),
    )
    return emails.filter(
      (email): email is GmailScanEmail =>
        email !== null && !isSameEmailAddress(email.from, externalAccountId),
    )
  }

  private async doGetThreadActivity(
    accessToken: string,
    threadId: string,
    occurredAt: string,
  ): Promise<GmailThreadActivity> {
    const response = await fetch(`${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (response.status === 401 || response.status === 403) {
      throw new GmailUnauthorizedError(`Gmail API returned ${response.status}`)
    }
    if (!response.ok) throw new Error(`Gmail thread API error ${response.status}`)

    const data = (await response.json()) as {
      messages?: Array<{
        internalDate?: string
        labelIds?: string[]
        payload?: { headers?: Array<{ name: string; value: string }> }
        snippet?: string
      }>
    }
    const candidateTimestamp = Date.parse(occurredAt)
    const laterMessages = (data.messages ?? []).filter((message) => {
      const timestamp = message.internalDate ? Number(message.internalDate) : Number.NaN
      return Number.isFinite(candidateTimestamp) && timestamp > candidateTimestamp
    })
    const answered = laterMessages.some((message) => message.labelIds?.includes('SENT'))
    const context = laterMessages
      .filter((message) => !message.labelIds?.includes('SENT'))
      .slice(-5)
      .map((message) => {
        const from = message.payload?.headers?.find(
          (header) => header.name.toLowerCase() === 'from',
        )?.value ?? 'unknown sender'
        return `From: ${from}\n${message.snippet ?? ''}`.slice(0, 600)
      })
      .join('\n---\n')

    return { resolution: answered ? 'answered' : 'unresolved', context }
  }

  private async fetchEmailMeta(
    accessToken: string,
    messageId: string,
    externalAccountId?: string,
  ): Promise<GmailScanEmail | null> {
    const url = `${GMAIL_MESSAGES_URL}/${messageId}?format=full`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      id: string
      threadId?: string
      snippet?: string
      labelIds?: string[]
      internalDate?: string
      payload?: {
        mimeType?: string
        headers?: Array<{ name: string; value: string }>
        body?: { data?: string }
        parts?: GmailPayload[]
      }
    }

    const headers = data.payload?.headers ?? []
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

    const receivedAt = data.internalDate
      ? new Date(parseInt(data.internalDate, 10)).toISOString()
      : new Date().toISOString()

    const email = {
      messageId: data.id,
      threadId: data.threadId,
      subject: header('Subject') || '(no subject)',
      from: header('From'),
      to: header('To'),
      cc: header('CC'),
      recipientRole: recipientRole(header('To'), header('CC'), externalAccountId),
      snippet: data.snippet ?? '',
      body: extractTextBody(data.payload) ?? data.snippet ?? '',
      receivedAt,
      labels: data.labelIds ?? [],
    }
    const googleDocsComment = parseGoogleDocsCommentNotification(email, externalAccountId)
    return googleDocsComment ? { ...email, googleDocsComment } : email
  }

  // ─── Reply actions ────────────────────────────────────────────────────────────

  /** Fetch full message metadata needed to compose a reply. */
  async getMessageDetails(userId: string, messageId: string): Promise<GmailMessageDetails> {
    const accessToken = await this.getValidAccessToken(userId)
    const url =
      `${GMAIL_MESSAGES_URL}/${messageId}` +
      `?format=metadata` +
      `&metadataHeaders=Message-ID` +
      `&metadataHeaders=From` +
      `&metadataHeaders=To` +
      `&metadataHeaders=CC` +
      `&metadataHeaders=Subject`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Gmail getMessageDetails failed: ${res.status}`)

    const data = (await res.json()) as {
      id: string
      threadId: string
      payload?: { headers?: Array<{ name: string; value: string }> }
    }

    const headers = data.payload?.headers ?? []
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

    return {
      messageId: data.id,
      threadId: data.threadId,
      rfcMessageId: header('Message-ID'),
      from: header('From'),
      to: header('To'),
      cc: header('CC'),
      subject: decodeRfc2047Header(header('Subject')),
    }
  }

  /** Send a reply to an existing Gmail thread. */
  async sendReply(
    userId: string,
    opts: {
      threadId: string
      rfcMessageId: string
      to: string
      cc?: string
      subject: string
      body: string
    },
  ): Promise<void> {
    const accessToken = await this.getValidAccessToken(userId)

    const replySubject = opts.subject.toLowerCase().startsWith('re:')
      ? opts.subject
      : `Re: ${opts.subject}`
    const subject = encodeRfc2047Header(replySubject)

    const lines: string[] = [
      `To: ${opts.to}`,
      ...(opts.cc ? [`CC: ${opts.cc}`] : []),
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=UTF-8`,
      ...(opts.rfcMessageId
        ? [`In-Reply-To: ${opts.rfcMessageId}`, `References: ${opts.rfcMessageId}`]
        : []),
      '',
      opts.body,
    ]
    const raw = Buffer.from(lines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const res = await fetch(`${GMAIL_MESSAGES_URL}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw, threadId: opts.threadId }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail sendReply failed: ${res.status} ${text}`)
    }
  }

  /** Remove the UNREAD label from a Gmail message. */
  async markMessageAsRead(userId: string, messageId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(userId)
    const res = await fetch(`${GMAIL_MESSAGES_URL}/${messageId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail markMessageAsRead failed: ${res.status} ${text}`)
    }
  }

  async markMessagesAsRead(userId: string, messageIds: string[]): Promise<void> {
    const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))]
    if (ids.length === 0 || ids.length > 50) {
      throw new Error('Gmail batch mark-read requires between 1 and 50 message IDs')
    }
    const accessToken = await this.getValidAccessToken(userId)
    const res = await fetch(`${GMAIL_MESSAGES_URL}/batchModify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids, removeLabelIds: ['UNREAD'] }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail batch mark-read failed: ${res.status} ${text}`)
    }
  }

  /** Return a valid (fresh if needed) access token for the given user. */
  private async getValidAccessToken(userId: string): Promise<string> {
    const tokens = await this.credentials.getTokens(userId, ConnectorType.GMAIL)
    const meta = await this.credentials.getMetadata(userId, ConnectorType.GMAIL)
    if (this.isNearExpiry(meta.tokenExpiresAt)) {
      return this.refreshAccessToken(userId, tokens.refreshToken)
    }
    return tokens.accessToken
  }
}

// ─── Local error type ─────────────────────────────────────────────────────────

export class GmailUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailUnauthorizedError'
  }
}

function isHttpUnauthorized(err: unknown): err is GmailUnauthorizedError {
  return err instanceof GmailUnauthorizedError
}
