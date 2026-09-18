import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { useJiraWorklogs } from './useJiraWorklogs'

vi.mock('../services/connectorsClient', () => ({
  fetchJiraWorklogs: vi.fn(),
}))

vi.mock('./useConnectors', () => ({
  useConnectors: () => ({
    connectors: [{ id: 'jira', status: 'connected' }],
  }),
}))

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: { accessToken: string }) => string) =>
    selector({ accessToken: 'token' }),
}))

import { fetchJiraWorklogs } from '../services/connectorsClient'

const STORAGE_KEY = 'houston.dashboard.worklogs.month'
const mockFetchJiraWorklogs = vi.mocked(fetchJiraWorklogs)

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useJiraWorklogs month persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockFetchJiraWorklogs.mockImplementation(async (_accessToken, year, month) => ({
      year,
      month,
      secondsPerDay: {},
    }))
  })

  it('načte rok a měsíc z localStorage při inicializaci', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ year: 2026, month: 5 }))

    const { result } = renderHook(() => useJiraWorklogs(), { wrapper: makeWrapper() })

    expect(result.current.year).toBe(2026)
    expect(result.current.month).toBe(5)

    await waitFor(() => {
      expect(mockFetchJiraWorklogs).toHaveBeenCalledWith('token', 2026, 5)
    })
  })

  it('uloží nový měsíc do localStorage po přepnutí', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ year: 2026, month: 12 }))

    const { result } = renderHook(() => useJiraWorklogs(), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(mockFetchJiraWorklogs).toHaveBeenCalledWith('token', 2026, 12)
    })

    act(() => {
      result.current.nextMonth()
    })

    await waitFor(() => {
      expect(result.current.year).toBe(2027)
      expect(result.current.month).toBe(1)
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ year: 2027, month: 1 }))
  })
})
