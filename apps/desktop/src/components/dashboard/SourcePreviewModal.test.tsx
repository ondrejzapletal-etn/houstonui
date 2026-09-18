import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import SourcePreviewModal from './SourcePreviewModal'
import { useAuthStore } from '../../store/authStore'
import type { ConnectorInfo, SourcePreviewEmail } from '@houston/shared-types'

vi.mock('../../services/sourcePreviewClient', () => ({
  fetchGmailPreview: vi.fn(),
  fetchSlackPreview: vi.fn(),
  markGmailPreviewRead: vi.fn(),
  markSlackPreviewRead: vi.fn(),
}))

vi.mock('../../services/connectorsClient', () => ({
  fetchJiraWorklogsDay: vi.fn(),
  fetchClockifyWorklogsDay: vi.fn(),
}))

import {
  fetchGmailPreview,
  fetchSlackPreview,
  markGmailPreviewRead,
  markSlackPreviewRead,
} from '../../services/sourcePreviewClient'
import { fetchClockifyWorklogsDay } from '../../services/connectorsClient'

const mockGmailPreview = vi.mocked(fetchGmailPreview)
const mockSlackPreview = vi.mocked(fetchSlackPreview)
const mockMarkGmailRead = vi.mocked(markGmailPreviewRead)
const mockMarkSlackRead = vi.mocked(markSlackPreviewRead)
const mockClockifyDay = vi.mocked(fetchClockifyWorklogsDay)

const gmail: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'connected',
  unreadCount: 2,
  lastCheckedAt: null,
}

const email: SourcePreviewEmail = {
  messageId: 'm1',
  subject: 'Revize smlouvy',
  from: 'pravnik@example.com',
  to: 'me@example.com',
  snippet: 'Posílám revidovanou verzi…',
  body: 'Posílám revidovanou verzi smlouvy k odsouhlasení.',
  receivedAt: '2026-05-07T08:30:00.000Z',
  labels: ['UNREAD'],
  isUnread: true,
}

function renderModal(
  connector: ConnectorInfo,
  onClose = vi.fn(),
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const result = render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(SourcePreviewModal, { connector, onClose }),
    ),
  )
  return { ...result, onClose, queryClient }
}

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({
    isAuthenticated: true,
    user: null,
    accessToken: 'test-token',
    expiresAt: Date.now() + 900_000,
  })
})

describe('SourcePreviewModal', () => {
  it('renders a 90% × 90% dialog labelled by the source name', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [email] })
    renderModal(gmail)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'Gmail' })).toBeInTheDocument()

    const panel = dialog.firstElementChild
    expect(panel).toHaveClass('h-[90vh]')
    expect(panel).toHaveClass('w-[90vw]')
  })

  it('distinguishes unread and read emails and expands the body on click', async () => {
    const readEmail: SourcePreviewEmail = {
      ...email,
      messageId: 'm2',
      subject: 'Hotová revize',
      labels: [],
      isUnread: false,
    }
    mockGmailPreview.mockResolvedValueOnce({ emails: [email, readEmail] })
    renderModal(gmail)

    const subject = await screen.findByText('Revize smlouvy')
    const row = subject.closest('button')
    expect(row).not.toBeNull()
    expect(screen.getByText('Revize smlouvy')).toHaveClass('font-bold', 'text-white')
    expect(screen.getByText('Hotová revize')).toHaveClass('font-normal', 'text-gray-300')
    expect(screen.getByText('Nepřečteno')).toBeInTheDocument()
    expect(screen.getByText('Přečteno')).toBeInTheDocument()
    expect(screen.queryByText('Bez reakce')).not.toBeInTheDocument()
    expect(screen.queryByText('Addressed to you')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /označit e-mail hotová revize/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('pravnik@example.com')).toHaveLength(2)
    expect(screen.queryByText(email.body)).not.toBeInTheDocument()

    fireEvent.click(row!)

    expect(screen.getByText(email.body)).toBeInTheDocument()
  })

  it('marks a Gmail preview item as read', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [email] })
    mockMarkGmailRead.mockResolvedValueOnce(undefined)
    renderModal(gmail)

    fireEvent.click(await screen.findByRole('button', { name: /označit e-mail revize smlouvy/i }))

    await waitFor(() => expect(mockMarkGmailRead).toHaveBeenCalledWith('test-token', 'm1'))
    expect(screen.queryByRole('button', { name: /označit e-mail revize smlouvy/i })).not.toBeInTheDocument()
    expect(screen.getByText('Přečteno')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [email] })
    const { onClose } = renderModal(gmail)

    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the ✕ button and on backdrop click', async () => {
    mockGmailPreview.mockResolvedValue({ emails: [email] })

    const { onClose } = renderModal(gmail)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Zavřít' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    const second = renderModal(gmail)
    fireEvent.click(await screen.findAllByRole('dialog').then((ds) => ds[1]))
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })

  it('offers an external link to the source web app', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [] })
    renderModal(gmail)

    const link = await screen.findByRole('link', { name: /otevřít v prohlížeči/i })
    expect(link).toHaveAttribute('href', 'https://mail.google.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('groups Slack messages by channel and uses the resolved user name', async () => {
    mockSlackPreview.mockResolvedValueOnce({
      channels: [
        {
          channelId: 'C1',
          channelName: 'dev-team',
          conversationType: 'channel',
          messages: [
            {
              channelId: 'C1',
              channelName: 'dev-team',
              ts: '1700000000.1',
              userId: 'U1',
              userName: 'jana',
              text: 'Deploy je venku',
              isUnread: true,
              hasResponded: true,
              isAddressedToUser: false,
            },
            {
              channelId: 'C1',
              channelName: 'dev-team',
              ts: '1699999999.1',
              userId: 'U2',
              userName: 'petr',
              text: 'Starší zpráva',
              isUnread: false,
              hasResponded: false,
              isAddressedToUser: true,
            },
          ],
        },
      ],
    })

    renderModal({ ...gmail, id: 'slack', label: 'Slack' })

    expect(await screen.findByText('#dev-team')).toBeInTheDocument()
    expect(screen.getByText('@jana')).toBeInTheDocument()
    expect(screen.getByText('Deploy je venku')).toHaveClass('font-semibold')
    expect(screen.queryByText('Starší zpráva')).not.toBeInTheDocument()
    expect(screen.getByText('Deploy je venku').closest('div')?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2023-11-14T22:13:20.100Z',
    )
    expect(screen.getByText('Nepřečteno')).toBeInTheDocument()
    expect(screen.getByText('Reagováno')).toBeInTheDocument()
    expect(screen.getByText('In copy only')).toBeInTheDocument()
  })

  it('marks a Slack preview item as read', async () => {
    mockSlackPreview.mockResolvedValueOnce({
      channels: [{
        channelId: 'C1',
        channelName: 'dev-team',
        messages: [{
          channelId: 'C1',
          channelName: 'dev-team',
          ts: '1700000000.1',
          userId: 'U1',
          userName: 'jana',
          text: 'Deploy je venku',
          isUnread: true,
          hasResponded: false,
          isAddressedToUser: false,
        }],
      }],
    })
    mockMarkSlackRead.mockResolvedValueOnce(undefined)
    const slackConnector = { ...gmail, id: 'slack' as const, label: 'Slack' }
    const firstRender = renderModal(slackConnector)
    const { queryClient } = firstRender

    fireEvent.click(await screen.findByRole('button', { name: /označit slack zprávu od jana/i }))

    await waitFor(() => expect(mockMarkSlackRead).toHaveBeenCalledWith(
      'test-token',
      'C1',
      '1700000000.1',
    ))
    expect(screen.queryByRole('button', { name: /označit slack zprávu od jana/i })).not.toBeInTheDocument()
    const cachedPreview = queryClient.getQueryData<{ channels: Array<{ messages: Array<{ isUnread: boolean }> }> }>(
      ['sourcePreview', 'slack'],
    )
    expect(cachedPreview?.channels[0].messages[0].isUnread).toBe(false)

    firstRender.unmount()
    renderModal(slackConnector, vi.fn(), queryClient)

    expect(await screen.findByText('Přečteno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /označit slack zprávu od jana/i })).not.toBeInTheDocument()
  })

  it('shows today\'s Clockify time entries with a total', async () => {
    mockClockifyDay.mockResolvedValueOnce({
      date: '2026-05-07',
      worklogs: [
        { id: 't1', project: 'Houston', description: 'Náhled zdrojů', started: '2026-05-07T08:00:00.000Z', timeSpentSeconds: 5400 },
        { id: 't2', project: 'Houston', description: 'Code review', started: '2026-05-07T10:00:00.000Z', timeSpentSeconds: 1800 },
      ],
    })

    renderModal({ ...gmail, id: 'clockify', label: 'Clockify' })

    expect(await screen.findByText('Náhled zdrojů')).toBeInTheDocument()
    expect(screen.getByText('1:30')).toBeInTheDocument()
    // 5400 + 1800 = 7200s = 2:00
    expect(screen.getByText('2:00')).toBeInTheDocument()
  })

  it('says the preview is unavailable for HotSpot without calling any client', async () => {
    renderModal({ ...gmail, id: 'hotspot', label: 'Hot Spot' })

    expect(
      await screen.findByText(/náhled obsahu pro tento zdroj není dostupný/i),
    ).toBeInTheDocument()
    expect(mockGmailPreview).not.toHaveBeenCalled()
    expect(mockSlackPreview).not.toHaveBeenCalled()
    expect(mockClockifyDay).not.toHaveBeenCalled()
  })

  it('does not fetch for a disconnected source and explains why', async () => {
    renderModal({ ...gmail, status: 'not_connected', unreadCount: null })

    expect(await screen.findByText(/zdroj není připojen/i)).toBeInTheDocument()
    expect(mockGmailPreview).not.toHaveBeenCalled()
    // No refresh affordance for a source we cannot read.
    expect(screen.queryByRole('button', { name: /obnovit/i })).not.toBeInTheDocument()
  })

  it('surfaces a provider error reported inside the envelope', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [], error: 'Token expired' })
    renderModal(gmail)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/obsah zdroje se nepodařilo načíst/i)).toBeInTheDocument()
    expect(screen.getByText('Token expired')).toBeInTheDocument()
  })

  it('surfaces a transport failure and retries on demand', async () => {
    mockGmailPreview
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ emails: [email] })
    renderModal(gmail)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /zkusit znovu/i }))

    expect(await screen.findByText('Revize smlouvy')).toBeInTheDocument()
  })

  it('shows an empty state when there are no emails', async () => {
    mockGmailPreview.mockResolvedValueOnce({ emails: [] })
    renderModal(gmail)

    expect(await screen.findByText(/žádné e-maily/i)).toBeInTheDocument()
  })
})
