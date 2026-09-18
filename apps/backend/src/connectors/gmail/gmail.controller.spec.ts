import { Test } from '@nestjs/testing'
import { AuditService } from '../../audit/audit.service'
import { UsersService } from '../../users/users.service'
import { TimeSavedService } from '../../users/time-saved.service'
import { GmailController } from './gmail.controller'
import { GmailScanSuggestionsService } from './gmail-scan-suggestions.service'
import { GmailService } from './gmail.service'

describe('GmailController', () => {
  const gmail = { markMessageAsRead: jest.fn(), fetchPreviewEmails: jest.fn() }
  const users = { incrementAutoRead: jest.fn(), incrementMarkRead: jest.fn(), getIdentity: jest.fn() }
  const audit = { log: jest.fn() }
  const timeSaved = { record: jest.fn() }
  const scanSuggestions = { removeFromLatestScan: jest.fn() }
  let controller: GmailController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module = await Test.createTestingModule({
      controllers: [GmailController],
      providers: [
        { provide: GmailService, useValue: gmail },
        { provide: UsersService, useValue: users },
        { provide: TimeSavedService, useValue: timeSaved },
        { provide: AuditService, useValue: audit },
        { provide: GmailScanSuggestionsService, useValue: scanSuggestions },
      ],
    }).compile()
    controller = module.get(GmailController)
  })

  it('marks a preview email as read and records manual time savings', async () => {
    gmail.markMessageAsRead.mockResolvedValueOnce(undefined)
    users.incrementMarkRead.mockResolvedValueOnce(4)

    const result = await controller.markRead(
      { id: 'user-1', email: 'user@example.com', entraId: 'entra-1' },
      { messageId: 'message-1' },
    )

    expect(gmail.markMessageAsRead).toHaveBeenCalledWith('user-1', 'message-1')
    expect(users.incrementMarkRead).toHaveBeenCalledWith('user-1')
    expect(timeSaved.record).toHaveBeenCalledWith('user-1', 'mark_read')
    expect(audit.log).toHaveBeenCalledWith('gmail.message_marked_read', expect.any(Object))
    expect(result).toEqual({ success: true, data: { source: 'gmail', markReadCount: 4 } })
  })

  it('removes only successfully marked messages from scan suggestions', async () => {
    gmail.markMessageAsRead
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Gmail request failed'))
    users.incrementAutoRead.mockResolvedValue(11)

    const result = await controller.batchMarkRead(
      { id: 'user-1', email: 'user@example.com', entraId: 'entra-1' },
      { messageIds: ['message-1', 'message-2'] },
    )

    expect(scanSuggestions.removeFromLatestScan).toHaveBeenCalledWith('user-1', ['message-1'])
    expect(result).toEqual({ success: true, data: { markedCount: 1, autoReadCount: 11 } })
  })

  describe('preview', () => {
    const user = { id: 'user-1', email: 'user@example.com', entraId: 'entra-1' }

    it('returns recent inbox messages without the scan-internal fields', async () => {
      gmail.fetchPreviewEmails.mockResolvedValueOnce([
        {
          messageId: 'm1',
          threadId: 't1',
          subject: 'Revize smlouvy',
          from: 'pravnik@example.com',
          to: 'me@example.com',
          cc: 'boss@example.com',
          recipientRole: 'to',
          resolution: 'unresolved',
          threadContext: 'předchozí zprávy…',
          snippet: 'Posílám revidovanou verzi…',
          body: 'Posílám revidovanou verzi smlouvy.',
          receivedAt: '2026-05-07T08:30:00.000Z',
          labels: ['UNREAD'],
          googleDocsComment: { documentTitle: 'Smlouva' },
        },
      ])

      const result = await controller.preview(user)

      expect(gmail.fetchPreviewEmails).toHaveBeenCalledWith('user-1', 30)
      expect(result).toEqual({
        success: true,
        data: {
          emails: [
            {
              messageId: 'm1',
              threadId: 't1',
              subject: 'Revize smlouvy',
              from: 'pravnik@example.com',
              to: 'me@example.com',
              snippet: 'Posílám revidovanou verzi…',
              body: 'Posílám revidovanou verzi smlouvy.',
              receivedAt: '2026-05-07T08:30:00.000Z',
              labels: ['UNREAD'],
              isUnread: true,
            },
          ],
        },
      })
    })

    it('reports a provider failure in the envelope instead of throwing', async () => {
      gmail.fetchPreviewEmails.mockRejectedValueOnce(new Error('Token expired'))

      const result = await controller.preview(user)

      expect(result).toEqual({
        success: true,
        data: { emails: [], error: 'Token expired' },
      })
    })
  })
})