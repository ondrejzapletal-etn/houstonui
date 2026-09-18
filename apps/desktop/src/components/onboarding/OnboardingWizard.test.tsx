import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import OnboardingWizard from './OnboardingWizard'
import type { ConnectorInfo } from '@houston/shared-types'

vi.mock('../../services/connectorsClient', () => ({
  fetchConnectors: vi.fn(),
  refreshConnectorUnread: vi.fn(),
  initiateConnectorConnect: vi.fn(),
  disconnectConnector: vi.fn(),
}))

import { fetchConnectors, initiateConnectorConnect } from '../../services/connectorsClient'

const mockFetchConnectors = vi.mocked(fetchConnectors)
const mockInitiateConnect = vi.mocked(initiateConnectorConnect)

const gmailNotConnected: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'not_connected',
  unreadCount: null,
  lastCheckedAt: null,
}

const gmailConnected: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'connected',
  unreadCount: 5,
  lastCheckedAt: '2026-05-11T10:00:00.000Z',
}

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingWizard />} />
          <Route path="/" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.removeItem('houston_onboarding_complete')
  mockFetchConnectors.mockResolvedValue({ connectors: [gmailNotConnected] })
  mockInitiateConnect.mockResolvedValue('https://accounts.google.com/o/oauth2/auth?foo=bar')
  vi.stubGlobal('open', vi.fn())
})

describe('OnboardingWizard', () => {
  it('renders welcome step initially', () => {
    renderWizard()
    expect(screen.getByText('Vítejte v Houston NextGen')).toBeInTheDocument()
    expect(screen.getByText('Pojďme na to →')).toBeInTheDocument()
  })

  it('advances to connect step on "Pojďme na to"', async () => {
    renderWizard()
    fireEvent.click(screen.getByText('Pojďme na to →'))
    expect(screen.getByText('Připojte Gmail')).toBeInTheDocument()
  })

  it('skipping onboarding navigates to dashboard and marks done', async () => {
    renderWizard()
    fireEvent.click(screen.getByText('Přeskočit nastavení'))
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })
    expect(localStorage.getItem('houston_onboarding_complete')).toBe('1')
  })

  it('connect button triggers initiateConnectorConnect and opens browser', async () => {
    renderWizard()
    fireEvent.click(screen.getByText('Pojďme na to →'))

    await waitFor(() => {
      expect(screen.getByText('Připojit Gmail')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Připojit Gmail'))

    await waitFor(() => {
      expect(mockInitiateConnect).toHaveBeenCalledWith('', 'gmail')
      expect(window.open).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/auth?foo=bar',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('auto-advances to success step when gmail becomes connected', async () => {
    // First render with not_connected, then re-query returns connected
    mockFetchConnectors
      .mockResolvedValueOnce({ connectors: [gmailNotConnected] })
      .mockResolvedValue({ connectors: [gmailConnected] })

    renderWizard()
    fireEvent.click(screen.getByText('Pojďme na to →'))

    await waitFor(() => {
      expect(screen.getByText('Připojit Gmail')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Připojit Gmail'))

    await waitFor(() => {
      expect(screen.getByText('Gmail připojen!')).toBeInTheDocument()
    }, { timeout: 8000 })

    expect(screen.getByText(/5 nepřečtených zpráv/)).toBeInTheDocument()
  })

  it('finish button navigates to dashboard and marks onboarding done', async () => {
    mockFetchConnectors.mockResolvedValue({ connectors: [gmailConnected] })

    renderWizard()
    fireEvent.click(screen.getByText('Pojďme na to →'))

    // Connect step sees gmail as already connected → should auto-advance
    await waitFor(() => {
      expect(screen.getByText('Gmail připojen!')).toBeInTheDocument()
    }, { timeout: 5000 })

    fireEvent.click(screen.getByText('Přejít na dashboard →'))

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })

    expect(localStorage.getItem('houston_onboarding_complete')).toBe('1')
  })
})
