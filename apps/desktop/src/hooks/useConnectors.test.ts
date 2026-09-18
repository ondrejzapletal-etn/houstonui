import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useConnectors } from './useConnectors'
import { useAuthStore } from '../store/authStore'
import type { ConnectorInfo } from '@houston/shared-types'

// Mock connectorsClient
vi.mock('../services/connectorsClient', () => ({
  fetchConnectors: vi.fn(),
  refreshConnectorUnread: vi.fn(),
  initiateConnectorConnect: vi.fn(),
  disconnectConnector: vi.fn(),
}))

import { fetchConnectors, refreshConnectorUnread } from '../services/connectorsClient'

const mockFetchConnectors = vi.mocked(fetchConnectors)
const mockRefreshConnectorUnread = vi.mocked(refreshConnectorUnread)

const gmailConnector: ConnectorInfo = {
  id: 'gmail',
  label: 'Gmail',
  status: 'connected',
  unreadCount: 3,
  lastCheckedAt: '2026-05-07T10:00:00.000Z',
}

const slackConnector: ConnectorInfo = {
  id: 'slack',
  label: 'Slack',
  status: 'not_connected',
  unreadCount: null,
  lastCheckedAt: null,
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
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

describe('useConnectors', () => {
  it('returns empty array while loading', () => {
    mockFetchConnectors.mockReturnValue(new Promise(() => {})) // never resolves

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.connectors).toEqual([])
  })

  it('returns connectors on success', async () => {
    mockFetchConnectors.mockResolvedValue({ connectors: [gmailConnector, slackConnector] })

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isError).toBe(false)
    expect(result.current.connectors).toHaveLength(2)
    expect(result.current.connectors[0].id).toBe('gmail')
  })

  it('sets isError on fetch failure', async () => {
    mockFetchConnectors.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.errorMessage).toBe('Network error')
    expect(result.current.connectors).toEqual([])
  })

  it('fetches connectors even without an access token (dev accommodation)', async () => {
    // enabled: true – backend accepts unauthenticated requests in development mode.
    // The token is passed as an empty string and the Authorization header is omitted.
    useAuthStore.setState({
      accessToken: null,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
    })
    mockFetchConnectors.mockResolvedValue({ connectors: [] })

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockFetchConnectors).toHaveBeenCalledWith('')
    expect(result.current.connectors).toEqual([])
  })

  it('refreshOne updates the target connector in cache', async () => {
    mockFetchConnectors.mockResolvedValue({ connectors: [gmailConnector, slackConnector] })
    const updatedGmail = { ...gmailConnector, unreadCount: 99 }
    mockRefreshConnectorUnread.mockResolvedValue(updatedGmail)

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refreshOne('gmail')
    })

    await waitFor(() => {
      const gmail = result.current.connectors.find((c) => c.id === 'gmail')
      expect(gmail?.unreadCount).toBe(99)
    })

    // Slack should be unchanged
    const slack = result.current.connectors.find((c) => c.id === 'slack')
    expect(slack?.status).toBe('not_connected')
  })

  it('refreshOne passes empty string as token when not authenticated (dev accommodation)', async () => {
    // In dev mode the backend accepts unauthenticated requests; refreshOne uses
    // empty string instead of a real token and the Authorization header is omitted.
    useAuthStore.setState({
      accessToken: null,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
    })
    const updatedGmail = { ...gmailConnector, unreadCount: 1 }
    mockRefreshConnectorUnread.mockResolvedValue(updatedGmail)
    mockFetchConnectors.mockResolvedValue({ connectors: [gmailConnector] })

    const { result } = renderHook(() => useConnectors(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refreshOne('gmail')
    })

    expect(mockRefreshConnectorUnread).toHaveBeenCalledWith('', 'gmail')
  })
})
