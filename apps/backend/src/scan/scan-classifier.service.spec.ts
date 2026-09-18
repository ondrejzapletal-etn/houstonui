import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import { ScanClassifierService } from './scan-classifier.service'
import type { ScanSourceData } from './scan-fetcher.service'

const emptySourceData: ScanSourceData = {
  gmail: { emails: [] },
  slack: { result: { channels: [], answeredMessages: [] } },
  calendar: { result: { events: [] } },
  jiraToday: { result: null },
  clockify: { result: null },
}

describe('ScanClassifierService', () => {
  let service: ScanClassifierService
  const ai = { chat: jest.fn() }

  beforeEach(async () => {
    jest.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        ScanClassifierService,
        { provide: AiGatewayService, useValue: ai },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile()

    service = module.get(ScanClassifierService)
  })

  it('provides pending proposals to the model and parses topic matches', async () => {
    ai.chat.mockResolvedValue(JSON.stringify({
      items: [{
        id: 'slack-C1-1',
        system: 'slack',
        tier: 1,
        summary: 'Arrange the GEO talk',
        detail: 'Zuzana is following up about the same talk.',
        topicKey: 'geo-zuzana-arrange-talk',
        existingProposalId: 'proposal-1',
      }],
    }))

    const result = await service.classify(emptySourceData, 'user-1', 'en', {
      clients: [],
      projects: [],
      pendingProposals: [{
        id: 'proposal-1',
        system: 'slack',
        summary: 'Arrange GEO talk with Zuzana',
        detail: 'Agree on a Tuesday slot.',
        topicKey: 'geo-zuzana-arrange-talk',
      }],
    })

    const messages = ai.chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain('## Existing pending proposals')
    expect(messages[0].content).toContain('id: proposal-1')
    expect(messages[0].content).toContain('Do not merge distinct requested actions')
    expect(result.items[0]).toEqual(expect.objectContaining({
      topicKey: 'geo-zuzana-arrange-talk',
      existingProposalId: 'proposal-1',
    }))
  })

  it('ignores invalid topic matching fields', async () => {
    ai.chat.mockResolvedValue(JSON.stringify({
      items: [{
        id: 'gmail-1',
        system: 'gmail',
        tier: 1,
        summary: 'Reply',
        detail: 'Reply requested.',
        topicKey: 'x'.repeat(161),
        existingProposalId: { id: 'proposal-1' },
      }],
    }))

    const result = await service.classify(emptySourceData, 'user-1')

    expect(result.items[0].topicKey).toBeUndefined()
    expect(result.items[0].existingProposalId).toBeUndefined()
  })

  it('aggregates only comments relevant to the dynamically identified user', async () => {
    ai.chat.mockResolvedValue(JSON.stringify({
      items: [
        { id: 'gmail-own', system: 'gmail', tier: 5, externalId: 'own', summary: 'Automated', detail: '' },
        { id: 'gmail-other', system: 'gmail', tier: 2, externalId: 'other', summary: 'Question for colleague', detail: '' },
        { id: 'gmail-untagged', system: 'gmail', tier: 2, externalId: 'untagged', summary: 'Please review', detail: '' },
      ],
    }))
    const sourceData: ScanSourceData = {
      ...emptySourceData,
      gmail: {
        emails: [
          docsEmail('own', ['signed.in@example.com'], true),
          docsEmail('other', ['colleague@example.com'], false),
          docsEmail('untagged', [], false),
        ],
      },
    }

    const result = await service.classify(sourceData, 'user-1')

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'DOCUMENT_REVIEW',
        tier: 1,
        sourceMessageIds: ['own', 'untagged'],
      }),
      expect.objectContaining({ externalId: 'other', tier: 3 }),
    ]))
    expect(result.items).toHaveLength(2)
    const messages = ai.chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('## Google Docs comment notifications')
    expect(messages[1].content).toContain('mentionsCurrentUser:true')
  })
})

function docsEmail(messageId: string, mentionedEmails: string[], mentionsCurrentUser: boolean) {
  return {
    messageId,
    subject: 'Comment in Houston',
    from: 'Google Docs <comments-noreply@docs.google.com>',
    to: 'signed.in@example.com',
    cc: '',
    recipientRole: 'to' as const,
    snippet: 'comment',
    body: 'comment',
    receivedAt: '2026-09-09T08:00:00.000Z',
    labels: ['UNREAD'],
    googleDocsComment: {
      documentId: 'document-1',
      documentUrl: 'https://docs.google.com/document/d/document-1',
      documentTitle: 'Houston',
      mentionedEmails,
      mentionsCurrentUser,
      mentionsOtherUsers: mentionedEmails.some((email) => email !== 'signed.in@example.com'),
      repliesToCurrentUser: false,
      commentText: `${messageId} comment`,
    },
  }
}
