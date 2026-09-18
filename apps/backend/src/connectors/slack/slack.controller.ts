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
import { AuditService } from '../../audit/audit.service'
import { TimeSavedService } from '../../users/time-saved.service'
import { UsersService } from '../../users/users.service'
import { SlackService } from './slack.service'

@Controller('slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name)

  constructor(
    private readonly slack: SlackService,
    private readonly users: UsersService,
    private readonly timeSaved: TimeSavedService,
    private readonly audit: AuditService,
  ) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private resolveUserId(user: CurrentUserData): string {
    if (user?.id) return user.id
    this.logger.error('SlackController: reached without an authenticated user – refusing')
    throw new UnauthorizedException()
  }

  /**
   * Read-only content preview for the dashboard source modal: unread channels
   * and DMs. `fetchScanMessages` keeps a 60s in-memory cache, so reopening the
   * modal is free.
   *
   * Provider failures are reported inside the envelope rather than thrown — the
   * modal shows the message in place of an empty list.
   */
  @Get('preview')
  async preview(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user)

    try {
      const [{ channels, answeredMessages }, identity] = await Promise.all([
        this.slack.fetchScanMessages(userId, true),
        this.users.getIdentity(userId),
      ])
      const answeredKeys = new Set(
        answeredMessages.map((message) => `${message.channelId}:${message.ts}`),
      )
      const mentionValues = [identity?.email ?? user.email, identity?.displayName]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => `@${value.trim().toLocaleLowerCase()}`)
      return {
        success: true,
        data: {
          channels: channels.flatMap((channel) => {
            const latestMessage = channel.messages.reduce<(typeof channel.messages)[number] | null>(
              (latest, message) => !latest || Number(message.ts) > Number(latest.ts) ? message : latest,
              null,
            )
            if (!latestMessage) return []
            return [{
              ...channel,
              messages: [{
                ...latestMessage,
                isUnread: latestMessage.isUnread ?? true,
                hasResponded: answeredKeys.has(`${channel.channelId}:${latestMessage.ts}`),
                isAddressedToUser:
                  channel.conversationType === 'dm' ||
                  latestMessage.mentionsCurrentUser === true ||
                  mentionValues.some((mention) => latestMessage.text.toLocaleLowerCase().includes(mention)),
              }],
            }]
          }),
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`slack preview failed for user=${userId}: ${message}`)
      return { success: true, data: { channels: [], error: message } }
    }
  }

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { channelId?: unknown; ts?: unknown },
  ) {
    const userId = this.resolveUserId(user)
    if (typeof body?.channelId !== 'string' || !body.channelId.trim() || body.channelId.length > 255) {
      throw new BadRequestException('channelId must be a non-empty string of at most 255 characters')
    }
    if (
      typeof body?.ts !== 'string' ||
      !/^\d{1,16}\.\d{1,16}$/.test(body.ts)
    ) {
      throw new BadRequestException('ts must be a valid Slack message timestamp')
    }

    await this.slack.markMessageAsRead(userId, body.channelId, body.ts)
    const markReadCount = await this.users.incrementMarkRead(userId)
    void this.timeSaved.record(userId, 'mark_read')
    this.audit.log('slack.message_marked_read', {
      userId,
      metadata: { channelId: body.channelId, ts: body.ts },
    })
    return { success: true, data: { source: 'slack' as const, markReadCount } }
  }
}
