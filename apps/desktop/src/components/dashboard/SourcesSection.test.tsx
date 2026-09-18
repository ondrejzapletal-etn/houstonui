import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import SourcesSection from './SourcesSection'
import { useAuthStore } from '../../store/authStore'
import type { ConnectorInfo } from '@houston/shared-types'

// Mock connectorsClient so no real HTTP calls are made
vi.mock('../../services/connectorsClient', () => ({
  fetchConnectors: vi.fn(),
  refreshConnectorUnread: vi.fn(),
  initiateConnectorConnect: vi.fn(),
  disconnectConnector: vi.fn(),
}))

// Mock the preview client too – the preview modal must not hit the network
vi.mock('../../services/sourcePreviewClient', () => ({
  fetchGmailPreview: vi.fn(),
  fetchSlackPreview: vi.fn(),
}))

import { disconnectConnector, fetchConnectors } from '../../services/connectorsClient'
import { fetchGmailPreview } from '../../services/sourcePreviewClient'

const mockFetchConnectors = vi.mocked(fetchConnectors)
const mockDisconnectConnector = vi.mocked(disconnectConnector)
const mockFetchGmailPreview = vi.mocked(fetchGmailPreview)

const gmailConnector: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'connected',
  unreadCount: 7,
  lastCheckedAt: '2026-05-07T10:00:00.000Z',
}

const slackExpired: ConnectorInfo = {
  id: 'slack',
  label: 'Slack',
  status: 'token_expired',
  unreadCount: null,
  lastCheckedAt: null,
}

function renderInProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(SourcesSection),
    ),
  )
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

describe('SourcesSection', () => {
  it('renders the Sources heading', () => {
    mockFetchConnectors.mockReturnValue(new Promise(() => {}))
    renderInProviders()
    expect(screen.getByRole('heading', { name: /sources/i })).toBeInTheDocument()
  })

  it('shows the implemented credential storage details', () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [] })
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Security and privacy information' }))

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(/credentials stay on the server/i)
    expect(tooltip).toHaveTextContent(/access and refresh tokens in Azure Key Vault/i)
    expect(tooltip).toHaveTextContent(/PostgreSQL stores metadata and a reference to the secret/i)
  })

  it('shows loading skeletons while fetching', () => {
    mockFetchConnectors.mockReturnValue(new Promise(() => {}))
    const { container } = renderInProviders()
    // Two skeleton placeholders have aria-hidden
    const skeletons = container.querySelectorAll('[aria-hidden="true"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(2)
  })

  it('renders connector cards after successful fetch', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector, slackExpired] })
    renderInProviders()

    await waitFor(() => expect(screen.getByText('Gmail')).toBeInTheDocument())
    expect(screen.getByText('Slack')).toBeInTheDocument()
  })

  it('shows unread count badge for connected connector', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector] })
    renderInProviders()

    await waitFor(() => screen.getByText('Gmail'))
    // sr-only text "7 unread"
    expect(screen.getByText('7 unread')).toBeInTheDocument()
  })

  it('shows Re-authorise badge for token_expired connector', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [slackExpired] })
    renderInProviders()

    await waitFor(() => screen.getByText('Slack'))
    expect(screen.getByText(/re-authorise/i)).toBeInTheDocument()
  })

  it('shows error alert on fetch failure', async () => {
    mockFetchConnectors.mockRejectedValueOnce(new Error('Server down'))
    renderInProviders()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/could not load connector status/i)).toBeInTheDocument()
    expect(screen.getByText('Server down')).toBeInTheDocument()
  })

  it('"Try again" button triggers a refetch', async () => {
    mockFetchConnectors
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ connectors: [gmailConnector] })

    renderInProviders()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(screen.getByText('Gmail')).toBeInTheDocument())
    expect(mockFetchConnectors).toHaveBeenCalledTimes(2)
  })

  it('shows "Not connected" label for not_connected connector', async () => {
    const notConnected: ConnectorInfo = {
      id: 'slack',
      label: 'Slack',
      status: 'not_connected',
      unreadCount: null,
      lastCheckedAt: null,
    }
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [notConnected] })
    renderInProviders()

    await waitFor(() => screen.getByText('Slack'))
    expect(screen.getByText(/not connected/i)).toBeInTheDocument()
  })

  it('shows Error badge for error status connector', async () => {
    const errorConnector: ConnectorInfo = {
      id: 'gmail',
      label: 'Gmail',
      status: 'error',
      unreadCount: null,
      lastCheckedAt: null,
    }
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [errorConnector] })
    renderInProviders()

    await waitFor(() => screen.getByText('Gmail'))
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('shows the VPN warning immediately when the HOT SPOT card is hovered', async () => {
    const hotSpotWarning: ConnectorInfo = {
      id: 'hotspot',
      label: 'Hot Spot',
      status: 'warning',
      unreadCount: null,
      lastCheckedAt: null,
      errorMessage: 'Interní síť není dostupná, připoj se na VPN',
    }
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [hotSpotWarning] })
    renderInProviders()

    await waitFor(() => expect(screen.getByText('Hot Spot')).toBeInTheDocument())
    const card = screen.getByText('Hot Spot').closest('.card')
    const tooltip = screen.getByRole('tooltip', { name: 'Interní síť není dostupná, připoj se na VPN' })

    const warningIndicator = screen.getByTestId('warning-status-indicator')
    expect(warningIndicator).toHaveClass('ml-2')
    expect(warningIndicator.querySelector('path:last-child')).toHaveAttribute('fill', 'black')
    expect(screen.queryByText('Varování')).not.toBeInTheDocument()
    expect(card).not.toHaveAttribute('title')
    expect(tooltip).toHaveClass('opacity-0')

    fireEvent.mouseEnter(card!)

    expect(tooltip).toHaveClass('opacity-100')
  })

  it('shows connector errors in the card tooltip', async () => {
    const errorConnector: ConnectorInfo = {
      id: 'gmail',
      label: 'Gmail',
      status: 'error',
      unreadCount: null,
      lastCheckedAt: null,
      errorMessage: 'Připojení ke Gmailu se nezdařilo',
    }
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [errorConnector] })
    renderInProviders()

    await waitFor(() => expect(screen.getByText('Gmail')).toBeInTheDocument())
    const card = screen.getByText('Gmail').closest('.card')
    const tooltip = screen.getByRole('tooltip', { name: 'Připojení ke Gmailu se nezdařilo' })

    fireEvent.mouseEnter(card!)

    expect(tooltip).toHaveClass('opacity-100')
  })

  it('Refresh button is accessible with aria-label', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector] })
    renderInProviders()

    await waitFor(() => screen.getByText('Gmail'))
    const refreshBtn = screen.getByRole('button', { name: /refresh gmail unread count/i })
    expect(refreshBtn).toBeInTheDocument()
  })

  it('disconnects a connected source from its Actions menu', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector] })
    mockDisconnectConnector.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    renderInProviders()

    await screen.findByText('Gmail')
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('button', { name: 'Disconnect Gmail' }))

    await waitFor(() =>
      expect(mockDisconnectConnector).toHaveBeenCalledWith('test-token', 'gmail'),
    )
  })

  it('makes every source card accessible as a preview action', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector, slackExpired] })
    renderInProviders()

    await screen.findByText('Gmail')
    expect(screen.getByTestId('source-card-gmail')).toHaveAccessibleName('Otevřít náhled Gmail')
    expect(screen.getByTestId('source-card-slack')).toHaveAccessibleName('Otevřít náhled Slack')
  })

  it('opens the preview modal when the source card is clicked', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector] })
    mockFetchGmailPreview.mockResolvedValueOnce({
      emails: [
        {
          messageId: 'm1',
          subject: 'Faktura 2026/04',
          from: 'ucetni@example.com',
          to: 'me@example.com',
          snippet: 'Dobrý den, zasílám fakturu…',
          body: 'Dobrý den, zasílám fakturu za duben.',
          receivedAt: '2026-05-07T08:30:00.000Z',
          labels: ['UNREAD'],
          isUnread: true,
        },
      ],
    })
    const user = userEvent.setup()
    renderInProviders()

    await screen.findByText('Gmail')
    await user.click(screen.getByTestId('source-card-gmail'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(await screen.findByText('Faktura 2026/04')).toBeInTheDocument()
    expect(mockFetchGmailPreview).toHaveBeenCalledWith('test-token')
  })

  it('does not open the preview modal when the Actions menu is clicked', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [gmailConnector] })
    const user = userEvent.setup()
    renderInProviders()

    await screen.findByText('Gmail')
    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(screen.getByRole('button', { name: 'Disconnect Gmail' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockFetchGmailPreview).not.toHaveBeenCalled()
  })

  it('section has accessible landmark with heading', async () => {
    mockFetchConnectors.mockResolvedValueOnce({ connectors: [] })
    renderInProviders()

    await waitFor(() => screen.getByRole('heading', { name: /sources/i }))
    const section = screen.getByRole('region', { name: /sources/i })
    expect(section).toBeInTheDocument()
  })
})

// ─── GmailDevConnectButton tests ─────────────────────────────────────────────

describe('GmailDevConnectButton (dev mode)', () => {
  beforeEach(() => {
    // Ensure import.meta.env.DEV is true (Vitest sets it by default in test mode)
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(window, 'open').mockImplementation(() => null)
    mockFetchConnectors.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders "Připojit Gmail" button unconditionally in dev mode', () => {
    renderInProviders()
    expect(screen.getByRole('button', { name: /připojit gmail/i })).toBeInTheDocument()
  })

  it('renders the dev-mode badge text', () => {
    renderInProviders()
    expect(screen.getByText(/testovací.*vývojové chování/i)).toBeInTheDocument()
  })

  it('calls POST /connectors/gmail/connect on click', async () => {
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ authUrl: 'https://accounts.google.com/oauth?test=1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/connectors/gmail/connect'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('opens returned authUrl in a new window after success', async () => {
    const authUrl = 'https://accounts.google.com/oauth?test=1'
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ authUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(authUrl, '_blank', expect.any(String)),
    )
  })

  it('shows success message with dev note after opening window', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ authUrl: 'https://accounts.google.com/oauth?test=1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() => expect(screen.getByText(/okno prohlížeče otevřeno/i)).toBeInTheDocument())
    expect(screen.getByText(/dev flow/i)).toBeInTheDocument()
  })

  it('shows error alert when server returns non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() => expect(screen.getByRole('alert', { name: undefined })).toBeInTheDocument())
    expect(screen.getByText(/server vrátil 401/i)).toBeInTheDocument()
  })

  it('shows error alert on network failure', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Failed to fetch'))

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() => expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument())
  })

  it('shows error when server response is missing authUrl', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ something: 'else' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderInProviders()
    fireEvent.click(screen.getByRole('button', { name: /připojit gmail/i }))

    await waitFor(() =>
      expect(screen.getByText(/nevrátil platné pole authUrl/i)).toBeInTheDocument(),
    )
  })

  it('disables the button while connecting', async () => {
    // Never resolve so it stays in loading state
    vi.mocked(global.fetch).mockReturnValueOnce(new Promise(() => {}))

    renderInProviders()
    const btn = screen.getByRole('button', { name: /připojit gmail/i })
    fireEvent.click(btn)

    await waitFor(() => {
      const loadingBtn = screen.getByRole('button', { name: /připojit gmail/i })
      expect(loadingBtn).toBeDisabled()
      expect(loadingBtn).toHaveTextContent(/otevírám prohlížeč/i)
    })
  })
})
