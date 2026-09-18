import { evaluateProposalRelevance } from './scan-relevance.policy'
import type { ClassifiedItem } from './scan-classifier.service'
import type { ScanSourceData } from './scan-fetcher.service'

const now = new Date('2026-09-08T12:00:00.000Z')
const sourceData: ScanSourceData = {
  gmail: {
    emails: [{
      messageId: 'to-email',
      threadId: 'thread-1',
      subject: 'Please reply',
      from: 'sender@example.com',
      to: 'user@example.com',
      cc: '',
      recipientRole: 'to',
      snippet: '',
      body: '',
      receivedAt: '2026-09-07T12:00:00.000Z',
      labels: ['UNREAD'],
    }],
  },
  slack: {
    result: {
      channels: [{
        channelId: 'C073R9M2H97',
        channelName: 'proj-mze',
        conversationType: 'channel',
        messages: [{
          channelId: 'C073R9M2H97',
          channelName: 'proj-mze',
          ts: '1788854400.000000',
          userId: 'U_AUTHOR',
          userName: 'Daniel',
          text: '<@U_OTHER> sync on Monday',
          mentionsCurrentUser: false,
        }],
      }],
      answeredMessages: [],
    },
  },
  calendar: { result: { events: [] } },
  jiraToday: { result: null },
  clockify: { result: null },
}

const item = (overrides: Partial<ClassifiedItem> = {}): ClassifiedItem => ({
  id: 'item-1',
  system: 'gmail',
  tier: 1,
  summary: 'Reply',
  detail: 'A reply is requested.',
  externalId: 'to-email',
  ...overrides,
})

const options = { now, ageThresholdDays: 14, clientIds: new Set(['client-1']) }

describe('evaluateProposalRelevance', () => {
  it('allows a recent email addressed in To', () => {
    expect(evaluateProposalRelevance(item(), sourceData, options)).toEqual({ allowed: true })
  })

  it('rejects a channel message that mentions only other users', () => {
    expect(evaluateProposalRelevance(item({
      system: 'slack',
      externalId: '1788854400.000000',
    }), sourceData, options)).toEqual({ allowed: false, reason: 'not_addressed' })
  })

  it('allows an old direct Slack message that was not answered by the user', () => {
    sourceData.slack.result.channels[0].conversationType = 'dm'
    sourceData.slack.result.channels[0].messages[0].ts = '1787558399.999000'
    sourceData.slack.result.channels[0].messages[0].resolution = 'unresolved'

    expect(evaluateProposalRelevance(item({
      system: 'slack',
      externalId: '1787558399.999000',
    }), sourceData, options)).toEqual({ allowed: true })
  })

  it('rejects an old message until its resolution is verified', () => {
    sourceData.gmail.emails[0].receivedAt = '2026-08-24T11:59:59.999Z'

    expect(evaluateProposalRelevance(item(), sourceData, options)).toEqual({
      allowed: false,
      reason: 'old_message_unverified',
    })
  })

  it('allows an old directly addressed email when its thread remains unresolved', () => {
    sourceData.gmail.emails[0].receivedAt = '2026-08-24T11:59:59.999Z'
    sourceData.gmail.emails[0].resolution = 'unresolved'

    expect(evaluateProposalRelevance(item(), sourceData, options)).toEqual({ allowed: true })
  })
})