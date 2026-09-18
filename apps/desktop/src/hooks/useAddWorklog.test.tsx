import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAddWorklog } from './useAddWorklog'

const { addJiraWorklog, addRecentJiraIssue } = vi.hoisted(() => ({
  addJiraWorklog: vi.fn(),
  addRecentJiraIssue: vi.fn(),
}))

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (state: { accessToken: string }) => string) => selector({ accessToken: 'token' }),
}))

vi.mock('../store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ addRecentJiraIssue }),
  },
}))

vi.mock('../services/connectorsClient', () => ({
  addJiraWorklog,
}))

describe('useAddWorklog', () => {
  it('obnoví měsíční přehled a detail cílového issue', async () => {
    addJiraWorklog.mockResolvedValue({
      worklogId: 'wl-2',
      started: '2026-06-02T12:00:00.000+0000',
      timeSpentSeconds: 3600,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useAddWorklog(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        issueKey: 'ROSS-125',
        date: '2026-06-02',
        timeSpentSeconds: 3600,
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jira-worklogs', 2026, 6] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['monthly-worklog-issues', 2026, 6] })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['monthly-issue-worklogs', 2026, 6, 'jira', 'ROSS-125'],
    })
  })
})