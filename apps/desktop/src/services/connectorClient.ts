/**
 * connectorClient – frontend service for connector OAuth API calls.
 *
 * SECURITY:
 *  - Never handles tokens; only receives status metadata.
 *  - Validates OAuth URLs to allowed providers before opening in browser.
 *  - All calls go through the backend AI Gateway.
 */

import { API_BASE_URL } from '../config/api'
import type {
  ConnectorType,
  ConnectorsListResponse,
  ConnectorConnectData,
} from '@houston/shared-types'

/** Allowed OAuth provider hostnames for connector flows. */
const ALLOWED_OAUTH_HOSTNAMES: readonly string[] = [
  'accounts.google.com',
  'slack.com',
  'www.slack.com',
]

/**
 * Validates that an OAuth URL is from a known, allowed provider.
 * Throws if the URL is invalid or from an unexpected host.
 */
export function validateConnectorAuthUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid connector authorization URL received from server')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Connector authorization URL must use HTTPS')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_OAUTH_HOSTNAMES.includes(hostname)) {
    throw new Error(
      `Connector authorization URL from unexpected host: ${hostname}. ` +
        `Expected one of: ${ALLOWED_OAUTH_HOSTNAMES.join(', ')}`,
    )
  }

  return parsed
}

/**
 * Fetches the list of all connectors with status and cached unread counts.
 * Never returns token values.
 *
 * GET /connectors → { success: true, data: { connectors: ConnectorInfo[] } }
 */
export async function getConnectorsList(accessToken: string): Promise<ConnectorsListResponse> {
  const response = await fetch(`${API_BASE_URL}/connectors`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch connectors list: ${response.status}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid connectors list response from server')
  }

  const data = (json as Record<string, unknown>).data
  if (
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray((data as Record<string, unknown>).connectors)
  ) {
    throw new Error('Invalid connectors data from server')
  }

  return data as ConnectorsListResponse
}

/**
 * Initiates an OAuth connection for the given connector.
 * Returns a validated authorization URL that should be opened in the system browser.
 *
 * POST /connectors/:type/connect → { authUrl: string }
 */
export async function initiateConnectorConnect(
  type: ConnectorType,
  accessToken: string,
): Promise<ConnectorConnectData> {
  const response = await fetch(`${API_BASE_URL}/connectors/${type}/connect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => String(response.status))
    throw new Error(`Failed to initiate ${type} connection: ${text}`)
  }

  const json: unknown = await response.json()

  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as Record<string, unknown>).authUrl !== 'string'
  ) {
    throw new Error('Invalid connect response from server')
  }

  const authUrl = (json as Record<string, unknown>).authUrl as string

  // Validate URL is from an expected OAuth provider before returning
  validateConnectorAuthUrl(authUrl)

  return { authUrl }
}

/**
 * Disconnects (revokes) the given connector for the current user.
 *
 * POST /connectors/:type/disconnect → 204 No Content
 */
export async function disconnectConnector(type: ConnectorType, accessToken: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/connectors/${type}/disconnect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => String(response.status))
    throw new Error(`Failed to disconnect ${type}: ${text}`)
  }
}

/**
 * Forces an immediate unread count refresh for a single connector.
 *
 * POST /connectors/:type/refresh-unread → { unreadCount: number | null }
 */
export async function refreshConnectorUnread(
  type: ConnectorType,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/connectors/${type}/refresh-unread`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => String(response.status))
    throw new Error(`Failed to refresh ${type} unread count: ${text}`)
  }
}
