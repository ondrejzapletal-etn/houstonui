import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUpdateWorklog } from './useUpdateWorklog'

const { updateJiraWorklog } = vi.hoisted(() => ({ updateJiraWorklog: vi.fn() }))

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (state: { accessToken: string }) => string) => selector({ accessToken: 'token' }),
}))

vi.mock('../services/connectorsClient', () => ({
  updateJiraWorklog,
}))

describe('useUpdateWorklog', () => {
  it('obnoví původní i nový měsíc po přesunu worklogu', async () => {
    updateJiraWorklog.mockResolvedValue({
      worklogId: 'wl-1',
      started: '2026-06-02T12:00:00.000+0000',
      timeSpentSeconds: 3600,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateWorklog(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        worklogId: 'wl-1',
        previousDate: '2026-05-03',
        body: {
          issueKey: 'ROSS-124',
          date: '2026-06-02',
          timeSpentSeconds: 3600,
        },
      })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jira-worklogs', 2026, 5] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['monthly-worklog-issues', 2026, 5] })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['monthly-issue-worklogs', 2026, 5, 'jira', 'ROSS-124'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['jira-worklogs', 2026, 6] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['monthly-worklog-issues', 2026, 6] })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['monthly-issue-worklogs', 2026, 6, 'jira', 'ROSS-124'],
    })
  })
})