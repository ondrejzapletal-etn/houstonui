import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecentIssueSummaries } from './useRecentIssueSummaries'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'

const mocks = vi.hoisted(() => ({ fetchSummary: vi.fn() }))
vi.mock('../services/projectsClient', () => ({ fetchIssueSummary: mocks.fetchSummary }))

function openHook(knownSummaries = new Map<string, string>()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useRecentIssueSummaries(knownSummaries), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

describe('useRecentIssueSummaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useAuthStore.setState({ accessToken: 'token' })
    useSettingsStore.setState({ recentJiraIssues: [] })
    mocks.fetchSummary.mockResolvedValue(null)
  })

  afterEach(cleanup)

  it('keeps the resolved map stable across unrelated rerenders without fetching or persisting again', async () => {
    useSettingsStore.setState({ recentJiraIssues: [{ key: 'TIME-2' }] })
    mocks.fetchSummary.mockResolvedValue('Reporting')
    const { result, rerender } = openHook()
    await waitFor(() => expect(useSettingsStore.getState().recentJiraIssues[0].summary).toBe('Reporting'))
    const summaries = result.current
    const recentIssues = useSettingsStore.getState().recentJiraIssues
    const listener = vi.fn()
    const unsubscribe = useSettingsStore.subscribe(listener)
    try {
      rerender()
      expect(result.current).toBe(summaries)
      expect(useSettingsStore.getState().recentJiraIssues).toBe(recentIssues)
      expect(listener).not.toHaveBeenCalled()
      expect(mocks.fetchSummary).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('uses known names without requests and normalizes whitespace', () => {
    useSettingsStore.setState({
      recentJiraIssues: [{ key: 'TIME-2', summary: ' time-2 ' }, { key: 'CEZNFK-1', summary: ' Operativa ' }],
    })
    const { result } = openHook(new Map([['TIME-2', ' Reporting ']]))
    expect(result.current.get('TIME-2')).toBe('Reporting')
    expect(result.current.get('CEZNFK-1')).toBe('Operativa')
    expect(mocks.fetchSummary).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().recentJiraIssues).toEqual([
      { key: 'TIME-2', summary: 'Reporting' }, { key: 'CEZNFK-1', summary: 'Operativa' },
    ])
  })

  it('does not request names when the user is signed out', () => {
    useAuthStore.setState({ accessToken: null })
    useSettingsStore.setState({ recentJiraIssues: [{ key: 'TIME-2' }] })
    openHook()
    expect(mocks.fetchSummary).not.toHaveBeenCalled()
  })
})