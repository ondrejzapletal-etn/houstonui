/**
 * ProposalsService
 *
 * Manages Proposal lifecycle: list, approve, reject.
 * All mutations are audit-logged.
 * A user can only access their own proposals (enforced by userId filter).
 *
 * Auto-population:
 * When a Jira proposal is approved and its externalId is a valid Jira issue key,
 * the issue is upserted into the local JiraIssue cache so it becomes available
 * for worklog pre-filling without any extra manual step from the user.
 */

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ProposalKind, ProposalStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { IssuesService } from '../issues/issues.service'
import { GmailService } from '../connectors/gmail/gmail.service'
import { SlackService } from '../connectors/slack/slack.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { ClientsService } from '../clients/clients.service'
import { TimeSavedService } from '../users/time-saved.service'

const JIRA_ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

type CreateProposalFromSourceMessageRequest =
  | { source: 'gmail'; messageId: string }
  | { source: 'slack'; channelId: string; ts: string }

export interface MarkReadResult {
  status: 'READ'
  source: 'gmail' | 'slack'
  markReadCount: number
  counted: boolean
}

function resolveSourceRef(
  system: string,
  externalId: string,
): { sourceType: string; sourceRef: string } {
  const sourceType =
    system === 'slack' ? 'message' : system === 'gmail' ? 'email' : system
  const sourceRef =
    system === 'slack'
      ? externalId.split(':').slice(1).join(':') || externalId
      : externalId
  return { sourceType, sourceRef }
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly issuesService: IssuesService,
    private readonly gmail: GmailService,
    private readonly slack: SlackService,
    private readonly ai: AiGatewayService,
    private readonly knowledge: KnowledgeService,
    private readonly clients: ClientsService,
    private readonly timeSaved: TimeSavedService,
  ) {}

  async list(userId: string, status?: ProposalStatus) {
    return this.prisma.proposal.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: [{ tier: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        scanRunId: true,
        userId: true,
        system: true,
        kind: true,
        tier: true,
        summary: true,
        detail: true,
        draft: true,
        url: true,
        externalId: true,
        sourceMessageIds: true,
        status: true,
        confidence: true,
        risk: true,
        projectId: true,
        issueKey: true,
        originalMessage: true,
        sourceOccurredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  async createFromSourceMessage(
    userId: string,
    request: CreateProposalFromSourceMessageRequest,
  ) {
    const source = await this.getSourceMessage(userId, request)
    const existing = await this.prisma.proposal.findFirst({
      where: {
        userId,
        system: source.system,
        externalId: source.externalId,
        status: ProposalStatus.PENDING,
      },
    })
    if (existing) return existing

    const proposal = await this.prisma.proposal.create({
      data: {
        scanRunId: null,
        userId,
        system: source.system,
        kind: ProposalKind.MESSAGE_REPLY,
        tier: 1,
        summary: source.summary,
        detail: source.detail,
        draft: null,
        url: source.url,
        externalId: source.externalId,
        sourceMessageIds: [source.externalId],
        status: ProposalStatus.PENDING,
        confidence: null,
        risk: null,
        originalMessage: source.originalMessage,
        sourceOccurredAt: source.occurredAt,
      },
    })
    this.audit.log('proposal.created_from_source_message', {
      userId,
      connectorType: source.system,
      metadata: { proposalId: proposal.id, externalId: source.externalId },
    })
    return proposal
  }

  private async getSourceMessage(
    userId: string,
    request: CreateProposalFromSourceMessageRequest,
  ): Promise<{
    system: 'gmail' | 'slack'
    externalId: string
    summary: string
    detail: string
    url: string | null
    originalMessage: string
    occurredAt: Date | null
  }> {
    if (request.source === 'gmail') {
      const emails = await this.gmail.fetchPreviewEmails(userId)
      const email = emails.find((item) => item.messageId === request.messageId)
      if (!email) throw new NotFoundException('Gmail message is no longer available')

      const receivedAt = new Date(email.receivedAt)
      return {
        system: 'gmail',
        externalId: email.messageId,
        summary: email.subject || '(bez předmětu)',
        detail: email.from || 'Neznámý odesílatel',
        url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(email.messageId)}`,
        originalMessage: [
          `Message-ID: ${email.messageId}`,
          email.threadId ? `Thread-ID: ${email.threadId}` : '',
          `From: ${email.from}`,
          email.to ? `To: ${email.to}` : '',
          email.cc ? `CC: ${email.cc}` : '',
          `Subject: ${email.subject}`,
          `Date: ${email.receivedAt}`,
          email.labels.length > 0 ? `Labels: ${email.labels.join(', ')}` : '',
          `Snippet: ${email.snippet}`,
          '---',
          email.body || email.snippet,
        ].filter(Boolean).join('\n'),
        occurredAt: Number.isNaN(receivedAt.getTime()) ? null : receivedAt,
      }
    }

    const { channels, answeredMessages } = await this.slack.fetchScanMessages(userId, true)
    const channel = channels.find((item) => item.channelId === request.channelId)
    const message = channel?.messages.find((item) => item.ts === request.ts)
    if (!channel || !message) throw new NotFoundException('Slack message is no longer available')

    const occurredAt = new Date(Number(message.ts) * 1000)
    const externalId = `${channel.channelId}:${message.ts}`
    const hasResponded = answeredMessages.some(
      (item) => item.channelId === channel.channelId && item.ts === message.ts,
    )
    const conversationType = channel.conversationType ?? 'channel'
    return {
      system: 'slack',
      externalId,
      summary: message.text.slice(0, 160) || `Zpráva v #${channel.channelName}`,
      detail: `${conversationType === 'channel' ? '#' : '@'}${channel.channelName} | @${message.userName || message.userId}`,
      url: null,
      originalMessage: [
        `Channel: ${conversationType === 'channel' ? '#' : '@'}${channel.channelName}`,
        `Channel-ID: ${channel.channelId}`,
        `Conversation type: ${conversationType}`,
        `Author: @${message.userName || message.userId}`,
        `Author-ID: ${message.userId}`,
        `Timestamp: ${message.ts}`,
        message.threadTs ? `Thread timestamp: ${message.threadTs}` : '',
        `Unread: ${message.isUnread === true ? 'yes' : 'no'}`,
        `Responded: ${hasResponded ? 'yes' : 'no'}`,
        `Mentioned current user: ${message.mentionsCurrentUser === true ? 'yes' : 'no'}`,
        '---',
        message.text,
      ].filter(Boolean).join('\n'),
      occurredAt: Number.isNaN(occurredAt.getTime()) ? null : occurredAt,
    }
  }

  async approve(proposalId: string, userId: string, draft?: string) {
    const proposal = await this.getOwned(proposalId, userId)
    if (proposal.kind === ProposalKind.DOCUMENT_REVIEW) {
      throw new BadRequestException('Document review proposals must be resolved explicitly')
    }

    // Allow re-approval of already-APPROVED proposals so the user can retry a
    // failed Gmail send (e.g. after re-authorising with the correct scopes).
    const isRetry = proposal.status === ProposalStatus.APPROVED
    if (!isRetry && proposal.status !== ProposalStatus.PENDING) {
      throw new ForbiddenException(`Proposal is already ${proposal.status}`)
    }

    let updated = proposal
    if (!isRetry) {
      updated = await this.prisma.proposal.update({
        where: { id: proposalId },
        data: { status: ProposalStatus.APPROVED },
      })
      this.audit.log('proposal.approved', { userId, metadata: { proposalId, system: proposal.system } })
      this.logger.log(`Proposal ${proposalId} approved by user=${userId}`)

      // Auto-populate JiraIssue cache when a Jira proposal with a valid issue key is approved.
      if (proposal.system === 'jira' && proposal.externalId && JIRA_ISSUE_KEY_RE.test(proposal.externalId)) {
        this.issuesService
          .upsertFromKey(userId, { issueKey: proposal.externalId, summary: proposal.summary })
          .catch((err: unknown) =>
            this.logger.warn(`Failed to auto-populate issue ${proposal.externalId}: ${String(err)}`),
          )
      }
    } else {
      this.logger.log(`Proposal ${proposalId} re-approved (retry) by user=${userId}`)
    }

    // Knowledge action proposals: execute mutation based on draft JSON params
    if (proposal.system === 'knowledge') {
      const params = JSON.parse(proposal.draft ?? '{}') as Record<string, string>
      const { actionType, name, domain, notes, projectName, description, type: entityType } = params

      try {
        if (actionType === 'add_client') {
          if (!name) throw new Error('Chybí název klienta')
          await this.clients.create(userId, { name, domain, notes })
        } else if (actionType === 'create_task') {
          if (!name) throw new Error('Chybí název úkolu')
          const desc = [description, projectName ? `Projekt: ${projectName}` : ''].filter(Boolean).join('\n')
          const entity = await this.knowledge.createEntity(userId, { type: 'task', title: name, description: desc || undefined })
          if (projectName) {
            const matches = await this.knowledge.searchEntities(userId, projectName, 'project')
            if (matches.length > 0) {
              await this.knowledge.createRelation(userId, {
                fromEntityId: entity.id,
                toEntityId: matches[0].id,
                relationType: 'PART_OF',
              }).catch(() => {})
            }
          }
        } else if (actionType === 'add_entity') {
          if (!name) throw new Error('Chybí název entity')
          const validTypes = ['person', 'task', 'project', 'conversation', 'artifact', 'organization'] as const
          const safeType = validTypes.includes(entityType as typeof validTypes[number])
            ? (entityType as typeof validTypes[number])
            : 'artifact'
          await this.knowledge.createEntity(userId, { type: safeType, title: name, description })
        }
        this.audit.log('proposal.knowledge_action_executed', { userId, metadata: { proposalId, actionType } })
        this.logger.log(`Knowledge action executed for proposal=${proposalId} actionType=${actionType}`)
      } catch (err: unknown) {
        this.logger.warn(`Knowledge action failed for proposal=${proposalId}: ${String(err)}`)
        throw err
      }
      return updated
    }

    // For Gmail proposals: send reply and mark original as read.
    // On failure the error is propagated so the frontend knows the send did not succeed.
    if (proposal.system === 'gmail' && proposal.externalId) {
      const replyText = draft ?? proposal.draft ?? ''
      if (replyText) {
        try {
          const details = await this.gmail.getMessageDetails(userId, proposal.externalId)
          await this.gmail.sendReply(userId, {
            threadId: details.threadId,
            rfcMessageId: details.rfcMessageId,
            to: details.from,
            cc: [details.to, details.cc].filter(Boolean).join(', '),
            subject: details.subject,
            body: replyText,
          })
          await this.gmail.markMessageAsRead(userId, proposal.externalId)
          this.audit.log('proposal.gmail_reply_sent', {
            userId,
            metadata: { proposalId, messageId: proposal.externalId },
          })
          this.logger.log(`Gmail reply sent for proposal=${proposalId}`)
        } catch (err: unknown) {
          this.logger.warn(`Gmail reply/read failed for proposal=${proposalId}: ${String(err)}`)
          throw err
        }
      }
    }

    // For Slack proposals: send thread reply.
    // externalId format: "channelId:ts" (set during scan).
    if (proposal.system === 'slack' && proposal.externalId) {
      const replyText = draft ?? proposal.draft ?? ''
      if (replyText) {
        const colonIdx = proposal.externalId.indexOf(':')
        if (colonIdx > 0) {
          const channelId = proposal.externalId.slice(0, colonIdx)
          const threadTs = proposal.externalId.slice(colonIdx + 1)
          try {
            await this.slack.sendThreadReply(userId, { channelId, threadTs, text: replyText })
            this.audit.log('proposal.slack_reply_sent', {
              userId,
              metadata: { proposalId, channelId, threadTs },
            })
            this.logger.log(`Slack reply sent for proposal=${proposalId}`)
          } catch (err: unknown) {
            this.logger.warn(`Slack reply failed for proposal=${proposalId}: ${String(err)}`)
            throw err
          }
        }
      }
    }

    // Update knowledge graph: mark conversation entity as approved, create task entity
    void this.syncProposalEntity(userId, proposal, 'approved')
    void this.syncProposalAsTask(userId, proposal)

    return updated
  }

  async reject(proposalId: string, userId: string) {
    const proposal = await this.getOwned(proposalId, userId)
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new ForbiddenException(`Proposal is already ${proposal.status}`)
    }
    const updated = await this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: ProposalStatus.REJECTED },
    })
    this.audit.log('proposal.rejected', { userId, metadata: { proposalId, system: proposal.system } })
    this.logger.log(`Proposal ${proposalId} rejected by user=${userId}`)
    void this.syncProposalEntity(userId, proposal, 'rejected')
    return updated
  }

  async markRead(proposalId: string, userId: string): Promise<MarkReadResult> {
    const proposal = await this.getOwned(proposalId, userId)
    if (proposal.system !== 'gmail' && proposal.system !== 'slack') {
      throw new ForbiddenException('Only Gmail and Slack proposals can be marked as read')
    }
    if (proposal.status === ProposalStatus.READ) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      return {
        status: 'READ',
        source: proposal.system,
        markReadCount: user?.markReadCount ?? 0,
        counted: false,
      }
    }
    if (!proposal.externalId) {
      throw new BadRequestException('Proposal does not have a source message identifier')
    }
    if (proposal.system === 'gmail') {
      await this.gmail.markMessageAsRead(userId, proposal.externalId)
    }
    if (proposal.system === 'slack') {
      const [channelId, ts] = proposal.externalId.split(':')
      if (!channelId || !ts) {
        throw new BadRequestException('Proposal does not have a valid Slack message identifier')
      }
      await this.slack.markMessageAsRead(userId, channelId, ts)
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.proposal.updateMany({
        where: { id: proposalId, userId, status: ProposalStatus.PENDING },
        data: { status: ProposalStatus.READ },
      })
      const user = updated.count > 0
        ? await tx.user.update({
          where: { id: userId },
          data: { markReadCount: { increment: 1 } },
        })
        : await tx.user.findUnique({ where: { id: userId } })
      return { counted: updated.count > 0, markReadCount: user?.markReadCount ?? 0 }
    })
    if (result.counted) void this.timeSaved.record(userId, 'mark_read')
    this.audit.log('proposal.marked_read', {
      userId,
      metadata: { proposalId, source: proposal.system, counted: result.counted },
    })
    this.logger.log(`Proposal ${proposalId} marked as read by user=${userId}`)
    return { status: 'READ', source: proposal.system, ...result }
  }

  async resolveDocumentReview(proposalId: string, userId: string): Promise<MarkReadResult> {
    const proposal = await this.getOwned(proposalId, userId)
    if (proposal.kind !== ProposalKind.DOCUMENT_REVIEW) {
      throw new BadRequestException('Proposal is not a document review')
    }
    if (proposal.status === ProposalStatus.READ) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      return {
        status: 'READ',
        source: 'gmail',
        markReadCount: user?.markReadCount ?? 0,
        counted: false,
      }
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new ForbiddenException(`Proposal is already ${proposal.status}`)
    }
    if (proposal.sourceMessageIds.length === 0) {
      throw new BadRequestException('Document review does not contain source messages')
    }

    await this.gmail.markMessagesAsRead(userId, proposal.sourceMessageIds)
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.proposal.updateMany({
        where: { id: proposalId, userId, status: ProposalStatus.PENDING },
        data: { status: ProposalStatus.READ },
      })
      const user = updated.count > 0
        ? await tx.user.update({
          where: { id: userId },
          data: { markReadCount: { increment: proposal.sourceMessageIds.length } },
        })
        : await tx.user.findUnique({ where: { id: userId } })
      return { counted: updated.count > 0, markReadCount: user?.markReadCount ?? 0 }
    })
    if (result.counted) void this.timeSaved.record(userId, 'mark_read', proposal.sourceMessageIds.length)
    this.audit.log('proposal.document_review_resolved', {
      userId,
      metadata: {
        proposalId,
        sourceMessageCount: proposal.sourceMessageIds.length,
        counted: result.counted,
      },
    })
    return { status: 'READ', source: 'gmail', ...result }
  }

  async regenerateDraft(proposalId: string, userId: string, hint: string): Promise<string> {
    const proposal = await this.getOwned(proposalId, userId)
    const systemPrompt = `You are a professional communication assistant. The user will provide you with an original message and a short hint describing how they want to respond. Generate a polished, professional reply draft in the same language as the original message. Return only the draft text, no extra commentary. Do NOT include any closing signature, sign-off, or valediction — the user will add their own signature separately.`
    const userPrompt = [
      `Original message:\n${proposal.originalMessage ?? '(not available)'}`,
      proposal.summary ? `Summary: ${proposal.summary}` : '',
      proposal.detail ? `Context: ${proposal.detail}` : '',
      `Current draft:\n${proposal.draft ?? '(none)'}`,
      `User's reply intent: ${hint}`,
    ].filter(Boolean).join('\n\n')
    const draft = await this.ai.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { temperature: 0.5, maxTokens: 800, userId },
    )
    return draft.trim()
  }

  private async getOwned(proposalId: string, userId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } })
    if (!proposal) throw new NotFoundException(`Proposal ${proposalId} not found`)
    if (proposal.userId !== userId) throw new ForbiddenException('Access denied')
    return proposal
  }

  private async syncProposalEntity(
    userId: string,
    proposal: { system: string; externalId: string | null; summary: string; tier: number },
    status: string,
  ): Promise<void> {
    if (!proposal.externalId) return
    try {
      const { sourceType, sourceRef } = resolveSourceRef(proposal.system, proposal.externalId)
      const entity = await this.knowledge.findByExternalLink(proposal.system, sourceType, sourceRef)
      if (!entity) return
      await Promise.all([
        this.knowledge.upsertFactInternal(entity.id, 'proposal_status', status, 'houston'),
        this.knowledge.upsertFactInternal(entity.id, 'tier', proposal.tier, 'houston'),
        this.knowledge.appendEventInternal(userId, entity.id, `proposal_${status}`, { system: proposal.system }),
      ])
    } catch (err) {
      this.logger.warn(`KG proposal sync: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * When a proposal is approved, create a task entity representing the completed action.
   * This covers the "task = communication response" overlap: the task is done because the
   * proposal was acted upon. Links back to the conversation entity via DERIVED_FROM.
   */
  private async syncProposalAsTask(
    userId: string,
    proposal: { id: string; system: string; externalId: string | null; summary: string; issueKey: string | null },
  ): Promise<void> {
    try {
      const entity = await this.knowledge.resolveEntity(userId, 'proposal', 'task', proposal.id, {
        type: 'task',
        title: proposal.summary,
        status: 'done',
      })
      const facts: Promise<void>[] = [
        this.knowledge.upsertFactInternal(entity.id, 'proposalId', proposal.id, 'internal'),
        this.knowledge.upsertFactInternal(entity.id, 'source', proposal.system, 'internal'),
        this.knowledge.upsertFactInternal(entity.id, 'status', 'done', 'internal'),
        this.knowledge.upsertFactInternal(entity.id, 'priority', 'medium', 'internal'),
      ]
      if (proposal.issueKey) {
        facts.push(this.knowledge.upsertFactInternal(entity.id, 'jiraIssueKey', proposal.issueKey, 'internal'))
      }

      // Link task → conversation entity via DERIVED_FROM
      if (proposal.externalId) {
        const { sourceType, sourceRef } = resolveSourceRef(proposal.system, proposal.externalId)
        const convEntity = await this.knowledge.findByExternalLink(proposal.system, sourceType, sourceRef)
        if (convEntity) {
          facts.push(
            this.knowledge.createRelation(userId, {
              fromEntityId: entity.id,
              toEntityId: convEntity.id,
              relationType: 'DERIVED_FROM',
            }).catch(() => {}).then(() => {}),
          )
        }
      }

      await Promise.all(facts)
    } catch (err) {
      this.logger.warn(`KG proposal→task sync: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
