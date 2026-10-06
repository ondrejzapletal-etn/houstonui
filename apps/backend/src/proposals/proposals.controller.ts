import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common'
import { ProposalStatus } from '@prisma/client'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { CreateProposalFromSourceMessageDto } from './dto/create-proposal-from-source-message.dto'
import { ProposalsService, type MarkReadResult } from './proposals.service'

@Controller('proposals')
export class ProposalsController {
  private readonly logger = new Logger(ProposalsController.name)

  constructor(private readonly proposals: ProposalsService) {}

  /**
   * GlobalAuthGuard authenticates every route on this controller, so `user` is
   * always populated. Kept as a defence-in-depth assertion: approving a proposal
   * sends real Gmail and Slack messages, so it must never run without a subject.
   */
  private resolveUserId(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /**
   * GET /api/v1/proposals[?status=PENDING]
   * Returns proposals for the authenticated user, newest first.
   */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserData,
    @Query('status') status?: string,
  ) {
    const userId = this.resolveUserId(user, 'list')
    const parsedStatus = status ? (status.toUpperCase() as ProposalStatus) : undefined
    const items = await this.proposals.list(userId, parsedStatus)
    return { success: true, data: { proposals: items } }
  }

  /**
   * POST /api/v1/proposals/from-source-message
   * Creates a proposal only after an explicit user action. The backend reloads
   * the connector message itself, so message content is never trusted from the
   * desktop client.
   */
  @Post('from-source-message')
  @HttpCode(HttpStatus.CREATED)
  async createFromSourceMessage(
    @CurrentUser() user: CurrentUserData,
    @Body() body: CreateProposalFromSourceMessageDto,
  ) {
    const userId = this.resolveUserId(user, 'create-from-source-message')
    if (body.source === 'gmail') {
      if (!body.messageId || body.channelId !== undefined || body.ts !== undefined) {
        throw new BadRequestException('Gmail requests require only messageId')
      }
      const proposal = await this.proposals.createFromSourceMessage(userId, {
        source: 'gmail',
        messageId: body.messageId,
      })
      return { success: true, data: { proposal } }
    }

    if (!body.channelId || !body.ts || body.messageId !== undefined) {
      throw new BadRequestException('Slack requests require only channelId and ts')
    }
    const proposal = await this.proposals.createFromSourceMessage(userId, {
      source: 'slack',
      channelId: body.channelId,
      ts: body.ts,
    })
    return { success: true, data: { proposal } }
  }

  /**
   * POST /api/v1/proposals/:id/approve
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { draft?: string },
  ) {
    const userId = this.resolveUserId(user, 'approve')
    const proposal = await this.proposals.approve(id, userId, body?.draft)
    return { success: true, data: { proposal } }
  }

  /**
   * POST /api/v1/proposals/:id/reject
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const userId = this.resolveUserId(user, 'reject')
    const proposal = await this.proposals.reject(id, userId)
    return { success: true, data: { proposal } }
  }

  /**
   * POST /api/v1/proposals/:id/regenerate-draft
   * Regenerates the draft reply based on a short user hint.
   */
  @Post(':id/regenerate-draft')
  @HttpCode(HttpStatus.OK)
  async regenerateDraft(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { hint: string },
  ) {
    const userId = this.resolveUserId(user, 'regenerate-draft')
    const draft = await this.proposals.regenerateDraft(id, userId, body?.hint ?? '')
    return { success: true, data: { draft } }
  }

  /**
   * POST /api/v1/proposals/:id/mark-read
    * Marks the source message as read and resolves the proposal.
   */
  @Post(':id/mark-read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<{ success: true; data: MarkReadResult }> {
    const userId = this.resolveUserId(user, 'mark-read')
    const result = await this.proposals.markRead(id, userId)
    return { success: true, data: result }
  }

  @Post(':id/resolve-document-review')
  @HttpCode(HttpStatus.OK)
  async resolveDocumentReview(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<{ success: true; data: MarkReadResult }> {
    const userId = this.resolveUserId(user, 'resolve-document-review')
    const result = await this.proposals.resolveDocumentReview(id, userId)
    return { success: true, data: result }
  }
}
