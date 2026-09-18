/** Shared types for the source-preview feature — in-app read-only view of a connector's content. */

// ─── Gmail ────────────────────────────────────────────────────────────────────

/** Single email as returned by GET /gmail/preview. */
export interface SourcePreviewEmail {
  messageId: string
  threadId?: string
  subject: string
  from: string
  to: string
  snippet: string
  /** Plain-text body, truncated server-side. */
  body: string
  receivedAt: string // ISO 8601
  labels: string[]
  isUnread: boolean
}

export interface GmailPreviewData {
  emails: SourcePreviewEmail[]
  /** Present when the provider call failed; the list is then empty. */
  error?: string
}

export interface GmailPreviewResponse {
  success: true
  data: GmailPreviewData
}

// ─── Slack ────────────────────────────────────────────────────────────────────

/** Single Slack message as returned by GET /slack/preview. */
export interface SourcePreviewSlackMessage {
  channelId: string
  channelName: string
  ts: string
  userId: string
  userName: string
  text: string
  threadTs?: string
  mentionsCurrentUser?: boolean
  isUnread: boolean
  hasResponded: boolean
  isAddressedToUser: boolean
}

export interface SourcePreviewSlackChannel {
  channelId: string
  channelName: string
  conversationType?: 'dm' | 'mpim' | 'channel'
  messages: SourcePreviewSlackMessage[]
}

export interface SlackPreviewData {
  channels: SourcePreviewSlackChannel[]
  /** Present when the provider call failed; the list is then empty. */
  error?: string
}

export interface SlackPreviewResponse {
  success: true
  data: SlackPreviewData
}
