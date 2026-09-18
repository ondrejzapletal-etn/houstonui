import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markGmailPreviewRead, markSlackPreviewRead } from './sourcePreviewClient'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('source preview mark-read actions', () => {
  it('marks a Gmail message as read', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })

    await markGmailPreviewRead('token-abc', 'message-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/gmail/mark-read'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
        body: JSON.stringify({ messageId: 'message-1' }),
      }),
    )
  })

  it('marks a Slack message as read', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })

    await markSlackPreviewRead('token-abc', 'C123', '1700000000.100000')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/slack/mark-read'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 'C123', ts: '1700000000.100000' }),
      }),
    )
  })

  it('rejects a failed provider action', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 })

    await expect(markGmailPreviewRead('token-abc', 'message-1')).rejects.toThrow('HTTP 502')
  })
})
