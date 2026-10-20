import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarIssueLinkDto } from '@houston/shared-types'
import { CALENDAR_LINK_QUERY_KEY, useCalendarLink, useSaveCalendarLink } from './useCalendarLink'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), upsert: vi.fn() }))

vi.mock('../services/projectsClient', () => ({
  fetchCalendarLink: mocks.fetch,
  upsertCalendarLink: mocks.upsert,
}))

const link: CalendarIssueLinkDto = {
  id: 'link-1',
  calendarEventId: 'event-1',
  issueKey: 'PROJ-7',
  createdAt: '2026-10-08T09:00:00Z',
  updatedAt: '2026-10-08T09:00:00Z',
}

describe('saving and reopening calendar bindings', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(cleanup)

  it.each([undefined, 'series-1'])('caches a saved link and loads it on reopening with series %s', async (recurringEventId) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    mocks.fetch.mockResolvedValue(null)
    const first = renderHook(() => useCalendarLink('event-1', recurringEventId), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(first.result.current.data).toBeNull()
    first.unmount()

    mocks.upsert.mockResolvedValue(link)
    mocks.fetch.mockResolvedValue(link)
    const save = renderHook(() => useSaveCalendarLink('event-1', recurringEventId), { wrapper })
    await act(async () => {
      await save.result.current.mutateAsync({ issueKey: 'PROJ-7' })
    })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.anything(), 'event-1', {
      issueKey: 'PROJ-7', recurringEventId,
    })
    expect(client.getQueryData([...CALENDAR_LINK_QUERY_KEY('event-1'), recurringEventId ?? ''])).toEqual(link)

    const reopened = renderHook(() => useCalendarLink('event-1', recurringEventId), { wrapper })
    expect(reopened.result.current.data?.issueKey).toBe('PROJ-7')
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
    expect(reopened.result.current.data).toEqual(link)
    client.clear()
  })

  it('does not create a cached binding when saving fails', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const key = [...CALENDAR_LINK_QUERY_KEY('event-1'), '']
    client.setQueryData(key, null)
    mocks.upsert.mockRejectedValue(new Error('Save rejected'))
    const { result } = renderHook(() => useSaveCalendarLink('event-1'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await act(async () => {
      await expect(result.current.mutateAsync({ issueKey: 'PROJ-7' })).rejects.toThrow('Save rejected')
    })
    expect(client.getQueryData(key)).toBeNull()
    client.clear()
  })
})