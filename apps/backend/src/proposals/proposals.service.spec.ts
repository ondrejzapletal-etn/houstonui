import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ProposalKind, ProposalStatus } from '@prisma/client'
import { ProposalsService } from './proposals.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { IssuesService } from '../issues/issues.service'
import { GmailService } from '../connectors/gmail/gmail.service'
import { SlackService } from '../connectors/slack/slack.service'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { ClientsService } from '../clients/clients.service'
import { TimeSavedService } from '../users/time-saved.service'

const mockProposal = {
  id: 'p1',
  scanRunId: 'sr1',
  userId: 'u1',
  system: 'gmail',
  kind: ProposalKind.MESSAGE_REPLY,
  tier: 1,
  summary: 'Reply to client',
  detail: null,
  draft: null,
  url: null,
  externalId: null,
  sourceMessageIds: [],
  status: ProposalStatus.PENDING,
  confidence: null,
  risk: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('ProposalsService', () => {
  let service: ProposalsService
  let prisma: {
    proposal: {
      findMany: jest.Mock
      findFirst: jest.Mock
      findUnique: jest.Mock
      create: jest.Mock
      update: jest.Mock
      updateMany: jest.Mock
    }
    user: { findUnique: jest.Mock; update: jest.Mock }
    $transaction: jest.Mock
  }
  let audit: { log: jest.Mock }
  let gmail: {
    fetchPreviewEmails: jest.Mock
    getMessageDetails: jest.Mock
    sendReply: jest.Mock
    markMessageAsRead: jest.Mock
    markMessagesAsRead: jest.Mock
  }
  let slack: { fetchScanMessages: jest.Mock; markMessageAsRead: jest.Mock }
  let ai: { chat: jest.Mock }

  beforeEach(async () => {
    prisma = {
      proposal: {
        findMany: jest.fn().mockResolvedValue([mockProposal]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(mockProposal),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'manual-1', ...data })),
        update: jest.fn().mockResolvedValue({ ...mockProposal, status: ProposalStatus.APPROVED }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ markReadCount: 0 }),
        update: jest.fn().mockResolvedValue({ markReadCount: 1 }),
      },
      $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (callback) => callback({ proposal: prisma.proposal, user: prisma.user }))
    audit = { log: jest.fn() }
    gmail = {
      fetchPreviewEmails: jest.fn(),
      getMessageDetails: jest.fn(),
      sendReply: jest.fn(),
      markMessageAsRead: jest.fn(),
      markMessagesAsRead: jest.fn(),
    }
    slack = { fetchScanMessages: jest.fn(), markMessageAsRead: jest.fn() }
    ai = { chat: jest.fn() }

    const module = await Test.createTestingModule({
      providers: [
        ProposalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: IssuesService, useValue: { upsertFromKey: jest.fn() } },
        { provide: GmailService, useValue: gmail },
        { provide: SlackService, useValue: { sendThreadReply: jest.fn(), ...slack } },
        { provide: AiGatewayService, useValue: ai },
        { provide: KnowledgeService, useValue: { resolveEntity: jest.fn(), findByExternalLink: jest.fn() } },
        { provide: ClientsService, useValue: { create: jest.fn() } },
        { provide: TimeSavedService, useValue: { record: jest.fn() } },
      ],
    }).compile()

    service = module.get(ProposalsService)
  })

  it('list returns proposals for the user', async () => {
    const result = await service.list('u1')
    expect(prisma.proposal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }))
    expect(prisma.proposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ sourceOccurredAt: true }),
    }))
    expect(result).toHaveLength(1)
  })

  it('creates a Gmail proposal from server-fetched source data without AI', async () => {
    gmail.fetchPreviewEmails.mockResolvedValue([{
      messageId: 'message-1',
      threadId: 'thread-1',
      subject: 'Revize smlouvy',
      from: 'Pravnik <pravnik@example.com>',
      to: 'Me <me@example.com>',
      cc: 'Team <team@example.com>',
      snippet: 'Posilam revizi.',
      body: 'Posilam revidovanou smlouvu.',
      receivedAt: '2026-09-21T08:30:00.000Z',
      labels: ['UNREAD', 'IMPORTANT'],
    }])
    const proposal = await service.createFromSourceMessage('u1', {
      source: 'gmail',
      messageId: 'message-1',
    })

    expect(gmail.fetchPreviewEmails).toHaveBeenCalledWith('u1')
    expect(prisma.proposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scanRunId: null,
        system: 'gmail',
        kind: ProposalKind.MESSAGE_REPLY,
        tier: 1,
        externalId: 'message-1',
        status: ProposalStatus.PENDING,
        draft: null,
        originalMessage: expect.stringContaining('Labels: UNREAD, IMPORTANT'),
      }),
    }))
    expect(ai.chat).not.toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalledWith('proposal.created_from_source_message', expect.objectContaining({
      userId: 'u1',
      metadata: expect.objectContaining({ proposalId: 'manual-1', externalId: 'message-1' }),
    }))
    expect(proposal.id).toBe('manual-1')
  })

  it('creates a Slack proposal with channel and message metadata', async () => {
    slack.fetchScanMessages.mockResolvedValue({
      channels: [{
        channelId: 'C1',
        channelName: 'dev-team',
        conversationType: 'channel',
        messages: [{
          ts: '1700000000.1',
          userId: 'U1',
          userName: 'Jana',
          text: 'Muzete prosim zkontrolovat deploy?',
          threadTs: '1700000000.1',
          isUnread: true,
          mentionsCurrentUser: true,
        }],
      }],
      answeredMessages: [],
    })

    await service.createFromSourceMessage('u1', {
      source: 'slack',
      channelId: 'C1',
      ts: '1700000000.1',
    })

    expect(prisma.proposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        system: 'slack',
        externalId: 'C1:1700000000.1',
        summary: 'Muzete prosim zkontrolovat deploy?',
        originalMessage: expect.stringContaining('Channel-ID: C1'),
      }),
    }))
  })

  it('returns an existing pending proposal instead of creating a duplicate', async () => {
    prisma.proposal.findFirst.mockResolvedValueOnce({ ...mockProposal, id: 'existing', externalId: 'message-1' })
    gmail.fetchPreviewEmails.mockResolvedValue([{
      messageId: 'message-1', threadId: 'thread-1', subject: 'Subject', from: 'sender@example.com',
      to: 'me@example.com', cc: '', snippet: '', body: '', receivedAt: '2026-09-21T08:30:00.000Z', labels: [],
    }])

    const proposal = await service.createFromSourceMessage('u1', { source: 'gmail', messageId: 'message-1' })

    expect(prisma.proposal.create).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalledWith('proposal.created_from_source_message', expect.anything())
    expect(proposal.id).toBe('existing')
  })

  it('approve updates status to APPROVED', async () => {
    const result = await service.approve('p1', 'u1')
    expect(result.status).toBe(ProposalStatus.APPROVED)
    expect(audit.log).toHaveBeenCalledWith('proposal.approved', expect.any(Object))
  })

  it('never approves a document review through the Gmail reply path', async () => {
    prisma.proposal.findUnique.mockResolvedValue({
      ...mockProposal,
      kind: ProposalKind.DOCUMENT_REVIEW,
      externalId: 'message-1',
      sourceMessageIds: ['message-1'],
      draft: 'Should never be sent',
    })

    await expect(service.approve('p1', 'u1')).rejects.toBeInstanceOf(BadRequestException)
    expect(gmail.sendReply).not.toHaveBeenCalled()
  })

  it('replies to all Gmail recipients by adding the original To and CC recipients', async () => {
    prisma.proposal.findUnique.mockResolvedValue({
      ...mockProposal,
      externalId: 'message-1',
      draft: 'Děkuji za zprávu.',
    })
    gmail.getMessageDetails.mockResolvedValue({
      threadId: 'thread-1',
      rfcMessageId: '<message-1@example.com>',
      from: 'Sender <sender@example.com>',
      to: 'User <user@gmail.com>',
      cc: 'Team <team@example.com>',
      subject: 'Články a ZP',
    })

    await service.approve('p1', 'u1')

    expect(gmail.sendReply).toHaveBeenCalledWith('u1', expect.objectContaining({
      to: 'Sender <sender@example.com>',
      cc: 'User <user@gmail.com>, Team <team@example.com>',
    }))
  })

  it('approve throws ForbiddenException for wrong user', async () => {
    prisma.proposal.findUnique.mockResolvedValue({ ...mockProposal, userId: 'other' })
    await expect(service.approve('p1', 'u1')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('approve throws NotFoundException when proposal does not exist', async () => {
    prisma.proposal.findUnique.mockResolvedValue(null)
    await expect(service.approve('nonexistent', 'u1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('reject updates status to REJECTED', async () => {
    prisma.proposal.update.mockResolvedValue({ ...mockProposal, status: ProposalStatus.REJECTED })
    const result = await service.reject('p1', 'u1')
    expect(result.status).toBe(ProposalStatus.REJECTED)
  })

  it('marks a Gmail source message as read and persists the proposal as READ', async () => {
    prisma.proposal.findUnique.mockResolvedValue({ ...mockProposal, externalId: 'message-1' })

    const result = await service.markRead('p1', 'u1')

    expect(gmail.markMessageAsRead).toHaveBeenCalledWith('u1', 'message-1')
    expect(prisma.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', userId: 'u1', status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.READ },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { markReadCount: { increment: 1 } },
    })
    expect(result).toEqual({ status: 'READ', source: 'gmail', markReadCount: 1, counted: true })
    expect(audit.log).toHaveBeenCalledWith('proposal.marked_read', expect.objectContaining({
      metadata: expect.objectContaining({ counted: true, source: 'gmail' }),
    }))
  })

  it('does not increment the count when a proposal was already marked as read', async () => {
    prisma.proposal.findUnique.mockResolvedValue({ ...mockProposal, status: ProposalStatus.READ })
    prisma.user.findUnique.mockResolvedValue({ markReadCount: 4 })

    const result = await service.markRead('p1', 'u1')

    expect(gmail.markMessageAsRead).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'READ', source: 'gmail', markReadCount: 4, counted: false })
  })

  it('resolves a document review by marking only its grouped source messages read', async () => {
    prisma.proposal.findUnique.mockResolvedValue({
      ...mockProposal,
      kind: ProposalKind.DOCUMENT_REVIEW,
      sourceMessageIds: ['docs-1', 'docs-2'],
    })
    prisma.user.update.mockResolvedValue({ markReadCount: 2 })

    const result = await service.resolveDocumentReview('p1', 'u1')

    expect(gmail.markMessagesAsRead).toHaveBeenCalledWith('u1', ['docs-1', 'docs-2'])
    expect(gmail.sendReply).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { markReadCount: { increment: 2 } },
    })
    expect(result).toEqual({ status: 'READ', source: 'gmail', markReadCount: 2, counted: true })
  })

  it('marks Slack messages as read but does not count an already approved proposal', async () => {
    prisma.proposal.findUnique.mockResolvedValue({
      ...mockProposal,
      system: 'slack',
      externalId: 'C123:1710000000.000000',
      status: ProposalStatus.APPROVED,
    })
    prisma.proposal.updateMany.mockResolvedValue({ count: 0 })
    prisma.user.findUnique.mockResolvedValue({ markReadCount: 2 })

    const result = await service.markRead('p1', 'u1')

    expect(slack.markMessageAsRead).toHaveBeenCalledWith('u1', 'C123', '1710000000.000000')
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'READ', source: 'slack', markReadCount: 2, counted: false })
  })
})
