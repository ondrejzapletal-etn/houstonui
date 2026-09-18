import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ScanStatus, ProposalStatus } from '@prisma/client'
import { ScanService } from './scan.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ScanFetcherService } from './scan-fetcher.service'
import { ScanClassifierService } from './scan-classifier.service'
import { UsersService } from '../users/users.service'
import { TimeSavedService } from '../users/time-saved.service'
import { KnowledgeIngestionService } from '../knowledge/knowledge-ingestion.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import type { ScanEvent, ScanProposalEvent } from './dto/scan-event.dto'

const receivedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

const mockSourceData = {
  gmail: { emails: [{ messageId: 'm1', subject: 'Hello', from: 'a@b.com', to: 'u@c.com', cc: '', recipientRole: 'to', snippet: 'hi', receivedAt, labels: ['UNREAD'] }] },
  slack: { result: { channels: [], answeredMessages: [] } },
  calendar: { result: { events: [] } },
  jiraToday: { result: null },
  clockify: { result: null },
}

const mockClassification = {
  items: [
    {
      id: 'gmail-m1',
      system: 'gmail' as const,
      tier: 1,
      summary: 'Reply to Hello',
      detail: 'Someone sent you a hello.',
      draft: 'Hi, thanks for reaching out!',
      url: 'https://mail.google.com/mail/u/0/#inbox/m1',
      externalId: 'm1',
      confidence: 0.9,
      risk: 'low',
      topicKey: 'reply-to-hello',
    },
  ],
  tierCounts: { 1: 1 },
  totalItems: 1,
}

describe('ScanService', () => {
  let service: ScanService
  let prisma: {
    scanRun: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock }
    proposal: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    client: { findMany: jest.Mock }
    project: { findMany: jest.Mock }
  }
  let classifier: { classify: jest.Mock }
  let audit: { log: jest.Mock }

  beforeEach(async () => {
    prisma = {
      scanRun: {
        create: jest.fn().mockResolvedValue({ id: 'sr1', userId: 'u1', status: ScanStatus.RUNNING }),
        update: jest.fn().mockResolvedValue({ id: 'sr1' }),
        findFirst: jest.fn(),
      },
      proposal: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'p1',
          scanRunId: 'sr1',
          userId: 'u1',
          system: 'gmail',
          tier: 1,
          summary: 'Reply to Hello',
          detail: 'Someone sent you a hello.',
          draft: null,
          url: null,
          externalId: 'm1',
          status: ProposalStatus.PENDING,
          confidence: 0.9,
          risk: 'low',
          topicKey: 'reply-to-hello',
        }),
      },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
    }

    classifier = { classify: jest.fn().mockResolvedValue(mockClassification) }
    audit = { log: jest.fn() }

    const module = await Test.createTestingModule({
      providers: [
        ScanService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ScanFetcherService, useValue: { fetchAll: jest.fn().mockResolvedValue(mockSourceData) } },
        { provide: ScanClassifierService, useValue: classifier },
        { provide: UsersService, useValue: { incrementScans: jest.fn() } },
        { provide: TimeSavedService, useValue: { record: jest.fn() } },
        { provide: KnowledgeIngestionService, useValue: { ingestScanData: jest.fn() } },
        { provide: KnowledgeService, useValue: { getClassifierContext: jest.fn().mockResolvedValue(null) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile()

    service = module.get(ScanService)
  })

  it('emits progress, log, proposal, and completed events', async () => {
    const events: ScanEvent[] = []
    for await (const event of service.runScan('u1')) {
      events.push(event)
    }

    const eventTypes = events.map((event) => event.type)
    const proposalEvent = events.find(
      (event): event is ScanProposalEvent => event.type === 'proposal',
    )

    expect(eventTypes).toContain('progress')
    expect(eventTypes).toContain('log')
    expect(eventTypes).toContain('proposal')
    expect(eventTypes).toContain('completed')
    expect(eventTypes).not.toContain('error')
    expect(proposalEvent?.proposal.sourceOccurredAt).toBe(receivedAt)
  })

  it('creates ScanRun and Proposal in DB', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of service.runScan('u1')) { /* drain */ }

    expect(prisma.scanRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', status: ScanStatus.RUNNING }) }),
    )
    expect(prisma.proposal.create).toHaveBeenCalledTimes(1)
    expect(prisma.proposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceOccurredAt: new Date(receivedAt) }),
    }))
    expect(prisma.scanRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ScanStatus.COMPLETED }) }),
    )
  })

  it('creates one proposal for repeated items with the same topic', async () => {
    classifier.classify.mockResolvedValue({
      items: [
        { ...mockClassification.items[0], id: 'geo-1', summary: 'GEO first follow-up', tier: 2, confidence: 0.95, topicKey: 'geo-zuzana-talk' },
        { ...mockClassification.items[0], id: 'geo-2', summary: 'GEO action required', tier: 1, confidence: 0.8, topicKey: 'GEO Zuzana talk' },
        { ...mockClassification.items[0], id: 'geo-3', summary: 'GEO latest follow-up', tier: 1, confidence: 0.7, topicKey: 'geo-zuzana-talk' },
      ],
      tierCounts: { 1: 2, 2: 1 },
      totalItems: 3,
    })

    for await (const _event of service.runScan('u1')) { /* drain */ }

    expect(prisma.proposal.create).toHaveBeenCalledTimes(1)
    expect(prisma.proposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summary: 'GEO action required', topicKey: 'geo-zuzana-talk' }),
    }))
  })

  it('does not create or emit a proposal already covered by a pending proposal', async () => {
    prisma.proposal.findMany.mockResolvedValueOnce([{
      id: 'existing-geo',
      system: 'slack',
      summary: 'Arrange GEO talk with Zuzana',
      detail: null,
      topicKey: 'geo-zuzana-talk',
    }])
    classifier.classify.mockResolvedValue({
      items: [{
        ...mockClassification.items[0],
        id: 'geo-follow-up',
        topicKey: 'geo-zuzana-talk',
        existingProposalId: 'existing-geo',
      }],
      tierCounts: { 1: 1 },
      totalItems: 1,
    })

    const events: ScanEvent[] = []
    for await (const event of service.runScan('u1')) events.push(event)

    expect(prisma.proposal.create).not.toHaveBeenCalled()
    expect(events.some((event) => event.type === 'proposal')).toBe(false)
    expect(events.find((event) => event.type === 'completed')).toEqual(expect.objectContaining({
      summary: expect.objectContaining({ proposalCount: 0 }),
    }))
  })

  it('refreshes an existing pending document review with newly relevant messages', async () => {
    prisma.proposal.findMany.mockResolvedValueOnce([{
      id: 'existing-docs',
      system: 'gmail',
      kind: 'DOCUMENT_REVIEW',
      summary: 'Review existing comments',
      detail: 'Old comment',
      tier: 2,
      topicKey: 'google-doc-document-1-review-comments',
      externalId: 'old-message',
      sourceMessageIds: ['old-message'],
    }])
    classifier.classify.mockResolvedValueOnce({
      items: [{
        ...mockClassification.items[0],
        kind: 'DOCUMENT_REVIEW',
        tier: 1,
        topicKey: 'google-doc-document-1-review-comments',
        sourceMessageIds: ['m1'],
      }],
      tierCounts: { 1: 1 },
      totalItems: 1,
    })

    for await (const _event of service.runScan('u1')) { /* drain */ }

    expect(prisma.proposal.create).not.toHaveBeenCalled()
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: 'existing-docs' },
      data: expect.objectContaining({
        tier: 1,
        sourceMessageIds: ['old-message', 'm1'],
      }),
    })
  })

  it('expires an answered Slack proposal and excludes it from classifier context', async () => {
    const sourceData = {
      ...mockSourceData,
      slack: {
        result: {
          channels: [],
          answeredMessages: [{ channelId: 'C1', ts: '100.000001' }],
        },
      },
    }
    const fetcher = (service as unknown as { fetcher: { fetchAll: jest.Mock } }).fetcher
    fetcher.fetchAll.mockResolvedValueOnce(sourceData)
    prisma.proposal.findMany.mockResolvedValueOnce([
      {
        id: 'answered-proposal',
        system: 'slack',
        summary: 'Already answered',
        detail: null,
        topicKey: 'answered-topic',
        externalId: 'C1:100.000001',
      },
      {
        id: 'active-proposal',
        system: 'slack',
        summary: 'Still active',
        detail: null,
        topicKey: 'active-topic',
        externalId: 'C1:100.000002',
      },
    ])
    prisma.proposal.updateMany.mockResolvedValueOnce({ count: 1 })
    classifier.classify.mockResolvedValueOnce({
      items: [],
      tierCounts: {},
      totalItems: 0,
    })

    for await (const _event of service.runScan('u1')) { /* drain */ }

    expect(prisma.proposal.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['answered-proposal'] },
        userId: 'u1',
        status: ProposalStatus.PENDING,
      },
      data: { status: ProposalStatus.EXPIRED },
    })
    expect(classifier.classify).toHaveBeenCalledWith(
      sourceData,
      'u1',
      undefined,
      expect.objectContaining({
        pendingProposals: [expect.objectContaining({ id: 'active-proposal' })],
      }),
    )
    expect(audit.log).toHaveBeenCalledWith('proposal.expired', {
      userId: 'u1',
      metadata: {
        scanRunId: 'sr1',
        proposalIds: ['answered-proposal'],
        expiredCount: 1,
        reason: 'slack_message_answered',
      },
    })
  })

  it('keeps distinct requested actions about the same project separate', async () => {
    classifier.classify.mockResolvedValue({
      items: [
        { ...mockClassification.items[0], id: 'geo-talk', topicKey: 'geo-zuzana-arrange-talk' },
        { ...mockClassification.items[0], id: 'geo-budget', topicKey: 'geo-zuzana-approve-budget' },
      ],
      tierCounts: { 1: 2 },
      totalItems: 2,
    })

    for await (const _event of service.runScan('u1')) { /* drain */ }

    expect(prisma.proposal.create).toHaveBeenCalledTimes(2)
  })

  it('persists relevant Docs comments together while allowing another-user comments into auto-read', async () => {
    const docsComment = {
      documentId: 'document-1',
      documentUrl: 'https://docs.google.com/document/d/document-1',
      documentTitle: 'Houston',
      mentionedEmails: ['signed.in@example.com'],
      mentionsCurrentUser: true,
      mentionsOtherUsers: false,
      repliesToCurrentUser: false,
      commentText: '@signed.in@example.com please review',
    }
    const sourceData = {
      ...mockSourceData,
      gmail: {
        emails: [
          { ...mockSourceData.gmail.emails[0], messageId: 'docs-1', body: 'first', googleDocsComment: docsComment },
          { ...mockSourceData.gmail.emails[0], messageId: 'docs-2', body: 'second', googleDocsComment: { ...docsComment, commentText: 'reply' } },
          { ...mockSourceData.gmail.emails[0], messageId: 'docs-other', subject: 'Comment for colleague', body: 'other' },
        ],
      },
    }
    const fetcher = (service as unknown as { fetcher: { fetchAll: jest.Mock } }).fetcher
    fetcher.fetchAll.mockResolvedValueOnce(sourceData)
    classifier.classify.mockResolvedValueOnce({
      items: [
        {
          ...mockClassification.items[0],
          id: 'google-docs-document-1',
          kind: 'DOCUMENT_REVIEW',
          externalId: 'docs-1',
          sourceMessageIds: ['docs-1', 'docs-2'],
          topicKey: 'google-doc-document-1-review-comments',
          draft: undefined,
        },
        {
          ...mockClassification.items[0],
          id: 'gmail-docs-other',
          tier: 3,
          externalId: 'docs-other',
          topicKey: undefined,
          draft: undefined,
        },
      ],
      tierCounts: { 1: 1, 3: 1 },
      totalItems: 2,
    })

    const events: ScanEvent[] = []
    for await (const event of service.runScan('u1')) events.push(event)

    expect(prisma.proposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: 'DOCUMENT_REVIEW',
        sourceMessageIds: ['docs-1', 'docs-2'],
      }),
    }))
    expect(events.find((event) => event.type === 'auto_read_suggestions')).toEqual({
      type: 'auto_read_suggestions',
      items: [expect.objectContaining({ messageId: 'docs-other' })],
    })
  })

  it('never offers an unparsed Google comment notification for auto-read', async () => {
    const sourceData = {
      ...mockSourceData,
      gmail: {
        emails: [{
          ...mockSourceData.gmail.emails[0],
          messageId: 'uncertain-docs-comment',
          from: 'Google Docs <comments-noreply@docs.google.com>',
          subject: 'New comment in Houston',
          body: '',
          snippet: '',
        }],
      },
    }
    const fetcher = (service as unknown as { fetcher: { fetchAll: jest.Mock } }).fetcher
    fetcher.fetchAll.mockResolvedValueOnce(sourceData)
    classifier.classify.mockResolvedValueOnce({
      items: [{
        ...mockClassification.items[0],
        id: 'gmail-uncertain-docs-comment',
        tier: 5,
        externalId: 'uncertain-docs-comment',
      }],
      tierCounts: { 5: 1 },
      totalItems: 1,
    })

    const events: ScanEvent[] = []
    for await (const event of service.runScan('u1')) events.push(event)

    expect(events.some((event) => event.type === 'auto_read_suggestions')).toBe(false)
  })

  it('returns only the latest scan snapshot for the current user', async () => {
    prisma.scanRun.findFirst.mockResolvedValue({
      id: 'sr1',
      status: ScanStatus.RUNNING,
      phase: 'classify',
      message: 'Classifying items with AI...',
      startedAt: new Date('2026-09-01T08:00:00.000Z'),
      completedAt: null,
      metadata: {
        tierCounts: { 3: 1 },
        totalItems: 1,
        proposalCount: 0,
        sources: { gmail: 1 },
        autoReadSuggestions: [{
          messageId: 'auto-read-1',
          subject: 'Newsletter',
          from: 'news@example.com',
          receivedAt,
        }],
      },
      proposals: [{
        id: 'p1',
        system: 'gmail',
        tier: 1,
        summary: 'Reply to Hello',
        detail: null,
        draft: null,
        url: null,
        externalId: null,
        status: ProposalStatus.READ,
        confidence: null,
        risk: null,
        originalMessage: null,
        sourceOccurredAt: null,
        issueKey: null,
      }],
    })

    const result = await service.getLatestScanStatus('u1')

    expect(prisma.scanRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      include: { proposals: { orderBy: { createdAt: 'asc' } } },
    }))
    expect(result).toEqual(expect.objectContaining({
      scan: expect.objectContaining({
        scanRunId: 'sr1',
        status: ScanStatus.RUNNING,
        phase: 'classify',
        message: 'Classifying items with AI...',
        proposals: [expect.objectContaining({ id: 'p1', status: ProposalStatus.READ })],
        autoReadSuggestions: [{
          messageId: 'auto-read-1',
          subject: 'Newsletter',
          from: 'news@example.com',
          receivedAt,
        }],
      }),
    }))
  })
})
