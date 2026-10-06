import { Test } from '@nestjs/testing'
import { AuditService } from '../../audit/audit.service'
import { TimeSavedService } from '../../users/time-saved.service'
import { UsersService } from '../../users/users.service'
import { SlackController } from './slack.controller'
import { SlackService } from './slack.service'

describe('SlackController', () => {
  const slack = { fetchScanMessages: jest.fn(), markMessageAsRead: jest.fn() }
  const users = { incrementMarkRead: jest.fn(), getIdentity: jest.fn() }
  const timeSaved = { record: jest.fn() }
  const audit = { log: jest.fn() }
  const user = { id: 'user-1', email: 'user@example.com', entraId: 'entra-1' }
  let controller: SlackController

  beforeEach(async () => {
    jest.clearAllMocks()
    users.getIdentity.mockResolvedValue({ email: 'user@example.com', displayName: 'Test User' })
    const module = await Test.createTestingModule({
      controllers: [SlackController],
      providers: [
        { provide: SlackService, useValue: slack },
        { provide: UsersService, useValue: users },
        { provide: TimeSavedService, useValue: timeSaved },
        { provide: AuditService, useValue: audit },
      ],
    }).compile()
    controller = module.get(SlackController)
  })

  it('marks a preview message as read and records manual time savings', async () => {
    slack.markMessageAsRead.mockResolvedValueOnce(undefined)
    users.incrementMarkRead.mockResolvedValueOnce(7)

    const result = await controller.markRead(user, {
      channelId: 'C123',
      ts: '1700000000.100000',
    })

    expect(slack.markMessageAsRead).toHaveBeenCalledWith(
      'user-1',
      'C123',
      '1700000000.100000',
    )
    expect(users.incrementMarkRead).toHaveBeenCalledWith('user-1')
    expect(timeSaved.record).toHaveBeenCalledWith('user-1', 'mark_read')
    expect(audit.log).toHaveBeenCalledWith('slack.message_marked_read', expect.any(Object))
    expect(result).toEqual({ success: true, data: { source: 'slack', markReadCount: 7 } })
  })

  describe('preview', () => {
    it('returns channels and drops the scan-pipeline bookkeeping', async () => {
      slack.fetchScanMessages.mockResolvedValueOnce({
        channels: [
          {
            channelId: 'C1',
            channelName: 'dev-team',
            conversationType: 'channel',
            messages: [
              {
                channelId: 'C1',
                channelName: 'dev-team',
                ts: '1699999999.1',
                userId: 'U2',
                userName: 'petr',
                text: 'Starší zpráva',
                isUnread: true,
              },
              {
                channelId: 'C1',
                channelName: 'dev-team',
                ts: '1700000000.1',
                userId: 'U1',
                userName: 'jana',
                text: 'Deploy je venku',
                isUnread: false,
              },
            ],
          },
        ],
        answeredMessages: [{ channelId: 'C1', ts: '1700000000.1' }],
      })

      const result = await controller.preview(user)

      expect(slack.fetchScanMessages).toHaveBeenCalledWith('user-1', true)
      expect(result.data).not.toHaveProperty('answeredMessages')
      expect(result.data.channels).toHaveLength(1)
      expect(result.data.channels[0].messages).toHaveLength(2)
      expect(result.data.channels[0].messages[0]).toEqual(expect.objectContaining({
        userName: 'petr', isUnread: true, hasResponded: false, isAddressedToUser: false,
      }))
      expect(result.data.channels[0].messages[1]).toEqual(expect.objectContaining({
        userName: 'jana', isUnread: false, hasResponded: true, isAddressedToUser: false,
      }))
    })

    it('reports a provider failure in the envelope instead of throwing', async () => {
      slack.fetchScanMessages.mockRejectedValueOnce(new Error('missing_scope'))

      const result = await controller.preview(user)

      expect(result).toEqual({
        success: true,
        data: { channels: [], error: 'missing_scope' },
      })
    })
  })
})
