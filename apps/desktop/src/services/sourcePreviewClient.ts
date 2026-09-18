import { API_BASE_URL } from '../config/api'
import type {
  GmailPreviewData,
  GmailPreviewResponse,
  SlackPreviewData,
  SlackPreviewResponse,
} from '@houston/shared-types'

/**
 * Fetches recent Gmail inbox messages for the source-preview modal.
 *
 * GET /api/v1/gmail/preview
 */
export async function fetchGmailPreview(accessToken: string): Promise<GmailPreviewData> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/gmail/preview`, { headers })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gmail preview fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = (await response.json()) as GmailPreviewResponse
  return json.data
}

/**
 * Fetches unread Slack channels and DMs for the source-preview modal.
 *
 * GET /api/v1/slack/preview
 */
export async function fetchSlackPreview(accessToken: string): Promise<SlackPreviewData> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/slack/preview`, { headers })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Slack preview fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = (await response.json()) as SlackPreviewResponse
  return json.data
}

async function markPreviewMessageRead(
  accessToken: string,
  path: string,
  body: Record<string, string>,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Mark read failed: HTTP ${response.status}`)
  }
}

export function markGmailPreviewRead(accessToken: string, messageId: string): Promise<void> {
  return markPreviewMessageRead(accessToken, 'gmail/mark-read', { messageId })
}

export function markSlackPreviewRead(
  accessToken: string,
  channelId: string,
  ts: string,
): Promise<void> {
  return markPreviewMessageRead(accessToken, 'slack/mark-read', { channelId, ts })
}
