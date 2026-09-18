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
    proposal: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    user: { findUnique: jest.Mock; update: jest.Mock }
    $transaction: jest.Mock
  }
  let audit: { log: jest.Mock }
  let gmail: { getMessageDetails: jest.Mock; sendReply: jest.Mock; markMessageAsRead: jest.Mock; markMessagesAsRead: jest.Mock }
  let slack: { markMessageAsRead: jest.Mock }

  beforeEach(async () => {
    prisma = {
      proposal: {
        findMany: jest.fn().mockResolvedValue([mockProposal]),
        findUnique: jest.fn().mockResolvedValue(mockProposal),
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
    gmail = { getMessageDetails: jest.fn(), sendReply: jest.fn(), markMessageAsRead: jest.fn(), markMessagesAsRead: jest.fn() }
    slack = { markMessageAsRead: jest.fn() }

    const module = await Test.createTestingModule({
      providers: [
        ProposalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: IssuesService, useValue: { upsertFromKey: jest.fn() } },
        { provide: GmailService, useValue: gmail },
        { provide: SlackService, useValue: { sendThreadReply: jest.fn(), markMessageAsRead: slack.markMessageAsRead } },
        { provide: AiGatewayService, useValue: { chat: jest.fn() } },
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
