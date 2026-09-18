/** Supported connector types (must match Prisma ConnectorType enum values) */
export type ConnectorType = 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot'

/**
 * Connection state surfaced to the frontend.
 *
 * - connected      – OAuth token is valid; unreadCount is available
 * - not_connected  – user has never connected or explicitly disconnected
 * - token_expired  – refresh token expired; re-authorisation required
 * - error          – transient error (token still valid but count fetch failed)
 * - warning        – connected, but a non-credential dependency is unavailable
 */
export type ConnectorConnectionStatus = 'connected' | 'not_connected' | 'token_expired' | 'error' | 'warning'

/** Prisma ConnectorStatus values as string literals */
export type PrismaConnectorStatus = 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'REVOKED'

/** Prisma ConnectorType values as string literals */
export type PrismaConnectorType = 'GMAIL' | 'SLACK' | 'JIRA' | 'CLOCKIFY' | 'HOTSPOT'

/** Maps frontend connector type string → Prisma enum string */
export function toPrismaConnectorType(type: ConnectorType): PrismaConnectorType {
  switch (type) {
    case 'gmail':
      return 'GMAIL'
    case 'slack':
      return 'SLACK'
    case 'jira':
      return 'JIRA'
    case 'clockify':
      return 'CLOCKIFY'
    case 'hotspot':
      return 'HOTSPOT'
  }
}

/** Maps Prisma ConnectorStatus string → frontend ConnectorConnectionStatus */
export function toConnectionStatus(status: PrismaConnectorStatus): ConnectorConnectionStatus {
  switch (status) {
    case 'ACTIVE':
      return 'connected'
    case 'REVOKED':
      return 'not_connected'
    case 'EXPIRED':
      return 'token_expired'
    case 'INVALID':
      return 'error'
  }
}

/** Token data stored in the vault (never sent to frontend) */
export interface ConnectorTokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // Unix ms
  scope?: string
  externalAccountId?: string
}

/**
 * Runtime info for a single connector including live unread counts.
 * Returned by GET /api/v1/connectors.
 */
export interface ConnectorInfo {
  /** Stable machine-readable identifier */
  id: ConnectorType
  /** Human-readable display name */
  label: string
  /** Current lifecycle status */
  status: ConnectorConnectionStatus
  /**
   * Number of unread items (emails / DMs + mentions).
   * Only present when status === 'connected'; null otherwise.
   */
  unreadCount: number | null
  /** ISO-8601 timestamp of when the count was last successfully fetched */
  lastCheckedAt: string | null
  /** Optional non-credential availability message for a warning or error state. */
  errorMessage?: string
}

/** Response body of GET /api/v1/connectors */
export interface ConnectorsListResponse {
  connectors: ConnectorInfo[]
}
