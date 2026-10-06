import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../../auth/current-user.decorator'
import { GmailScanEmail, GmailService } from './gmail.service'
import { UsersService } from '../../users/users.service'
import { TimeSavedService } from '../../users/time-saved.service'
import { AuditService } from '../../audit/audit.service'
import { GmailScanSuggestionsService } from './gmail-scan-suggestions.service'

/**
 * Read-only email shape sent to the source-preview modal. Deliberately narrower
 * than {@link GmailScanEmail}: the AI-only fields (recipientRole, resolution,
 * threadContext, googleDocsComment) are internal to the scan pipeline and have
 * no place in the UI. Mirrors `SourcePreviewEmail` in @houston/shared-types.
 */
interface SourcePreviewEmail {
  messageId: string
  threadId?: string
  subject: string
  from: string
  to: string
  snippet: string
  body: string
  receivedAt: string
  labels: string[]
  isUnread: boolean
}

/** Max emails rendered in the preview modal. */
const PREVIEW_EMAIL_LIMIT = 100

function toPreviewEmail(email: GmailScanEmail): SourcePreviewEmail {
  return {
    messageId: email.messageId,
    threadId: email.threadId,
    subject: email.subject,
    from: email.from,
    to: email.to,
    snippet: email.snippet,
    body: email.body,
    receivedAt: email.receivedAt,
    labels: email.labels,
    isUnread: email.labels.includes('UNREAD'),
  }
}

@Controller('gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name)

  constructor(
    private readonly gmail: GmailService,
    private readonly users: UsersService,
    private readonly timeSaved: TimeSavedService,
    private readonly audit: AuditService,
    private readonly scanSuggestions: GmailScanSuggestionsService,
  ) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private resolveUserId(user: CurrentUserData): string {
    if (user?.id) return user.id
    this.logger.error('GmailController: reached without an authenticated user – refusing')
    throw new UnauthorizedException()
  }

  /**
  * Read-only content preview for the dashboard source modal: recent inbox messages.
   *
   * Provider failures are reported inside the envelope rather than thrown — the
   * modal shows the message in place of an empty list, matching how the calendar
   * routes in ConnectorsController degrade.
   */
  @Get('preview')
  async preview(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user)

    try {
      const emails = await this.gmail.fetchPreviewEmails(userId, PREVIEW_EMAIL_LIMIT)
      return { success: true, data: { emails: emails.map(toPreviewEmail) } }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`gmail preview failed for user=${userId}: ${message}`)
      return { success: true, data: { emails: [], error: message } }
    }
  }

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { messageId?: unknown },
  ) {
    const userId = this.resolveUserId(user)
    if (typeof body?.messageId !== 'string' || !body.messageId.trim() || body.messageId.length > 255) {
      throw new BadRequestException('messageId must be a non-empty string of at most 255 characters')
    }

    await this.gmail.markMessageAsRead(userId, body.messageId)
    const markReadCount = await this.users.incrementMarkRead(userId)
    void this.timeSaved.record(userId, 'mark_read')
    this.audit.log('gmail.message_marked_read', {
      userId,
      metadata: { messageId: body.messageId },
    })
    return { success: true, data: { source: 'gmail' as const, markReadCount } }
  }

  @Post('batch-mark-read')
  @HttpCode(HttpStatus.OK)
  async batchMarkRead(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { messageIds: string[] },
  ) {
    const userId = this.resolveUserId(user)

    if (!Array.isArray(body?.messageIds) || body.messageIds.length === 0)
      throw new BadRequestException('messageIds must be a non-empty array')
    if (body.messageIds.length > 50)
      throw new BadRequestException('Too many messageIds (max 50)')

    const results = await Promise.allSettled(
      body.messageIds.map((id) => this.gmail.markMessageAsRead(userId, id)),
    )
    const markedMessageIds = body.messageIds.filter((_, index) => results[index]?.status === 'fulfilled')
    const markedCount = markedMessageIds.length

    let autoReadCount = 0
    if (markedCount > 0) {
      try {
        await this.scanSuggestions.removeFromLatestScan(userId, markedMessageIds)
      } catch (error: unknown) {
        this.logger.error(
          `Failed to persist auto-read suggestion cleanup for user=${userId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      autoReadCount = await this.users.incrementAutoRead(userId, markedCount)
      void this.timeSaved.record(userId, 'auto_read', markedCount)
    }

    this.audit.log('gmail.batch_mark_read', { userId, metadata: { markedCount } })
    return { success: true, data: { markedCount, autoReadCount } }
  }
}
