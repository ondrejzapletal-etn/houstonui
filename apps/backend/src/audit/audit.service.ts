/**
 * AuditService
 *
 * Records every sensitive action to the audit_logs table.
 * All connector OAuth events, token operations and unread-count fetches
 * are audited here for GDPR compliance and security observability.
 *
 * Design:
 *  - Writes are fire-and-forget (errors are logged but NOT propagated)
 *    so that an audit write failure never blocks the main request.
 *  - Callers pass a typed `AuditAction` string so all audit events are
 *    documented in one place.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

// ─── Audit action catalogue ───────────────────────────────────────────────────

export type AuditAction =
  | 'connector.connect.initiated' // OAuth flow started
  | 'connector.connect.completed' // OAuth callback succeeded
  | 'connector.connect.failed' // OAuth callback / token exchange failed
  | 'connector.disconnect' // User disconnected a connector
  | 'connector.token.refreshed' // Access token refreshed automatically
  | 'connector.token.refresh_failed' // Refresh failed → credential marked invalid
  | 'connector.unread.fetched' // Unread count fetch succeeded
  | 'connector.unread.fetch_failed' // Unread count fetch failed
  | 'proposal.approved' // User approved a proposal
  | 'proposal.rejected' // User rejected a proposal
  | 'proposal.gmail_reply_sent' // Gmail reply sent after proposal approval
  | 'proposal.slack_reply_sent' // Slack thread reply sent after proposal approval
  | 'proposal.marked_read'      // Source message marked as read without approving
  | 'proposal.document_review_resolved' // Included Docs notifications marked read
  | 'proposal.document_review_updated' // Pending document review refreshed with new comments
  | 'proposal.expired' // Pending proposal became obsolete due to external source state
  | 'gmail.message_marked_read' // Gmail preview item manually marked read
  | 'gmail.batch_mark_read' // Batch mark emails as read
  | 'slack.message_marked_read' // Slack preview item manually marked read
  | 'scan.started' // Scan run initiated
  | 'scan.completed' // Scan run completed successfully
  | 'scan.failed' // Scan run failed
  | 'task.started' // Natural language task initiated
  | 'task.completed' // Natural language task completed
  | 'task.action_proposal' // Knowledge action proposal created
  | 'proposal.knowledge_action_executed' // Knowledge mutation executed after proposal approval

export interface AuditMetadata {
  connectorType?: string
  outcome?: 'success' | 'failure'
  errorCode?: string
  errorMessage?: string
  externalAccountId?: string
  requestId?: string
  [key: string]: unknown
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an audit event.
   * This is intentionally fire-and-forget – callers do NOT await.
   * If the DB write fails, the error is logged but not rethrown.
   */
  log(
    action: AuditAction,
    options: {
      userId?: string
      connectorType?: string
      metadata?: AuditMetadata
      ipAddress?: string
    } = {},
  ): void {
    const { userId, connectorType, metadata, ipAddress } = options

    this.prisma.auditLog
      .create({
        data: {
          userId: userId ?? null,
          action,
          connectorType: connectorType ?? null,
          metadata: (metadata as object | undefined) ?? undefined,
          ipAddress: ipAddress ?? null,
        },
      })
      .then(() => {
        this.logger.debug(
          `Audit: ${action} user=${userId ?? 'system'} connector=${connectorType ?? '-'}`,
        )
      })
      .catch((err: unknown) => {
        // Never let audit failure break the main flow
        this.logger.error(`Audit write failed for action=${action}: ${String(err)}`)
      })
  }
}
