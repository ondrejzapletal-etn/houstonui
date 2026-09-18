import { useQuery } from '@tanstack/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchCalendarLink, upsertCalendarLink } from '../services/projectsClient'
import type { CalendarIssueLinkDto, UpsertCalendarIssueLinkDto } from '@houston/shared-types'

export const CALENDAR_LINK_QUERY_KEY = (eventId: string) => ['calendar-links', eventId]

/**
 * Fetches the saved issue link for a calendar event.
 * Returns null when no link exists yet (never throws on 404 — the backend
 * normalises it to { data: { link: null } }).
 */
export function useCalendarLink(calendarEventId: string | undefined, recurringEventId?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<CalendarIssueLinkDto | null>({
    queryKey: [...CALENDAR_LINK_QUERY_KEY(calendarEventId ?? ''), recurringEventId ?? ''],
    queryFn: () => fetchCalendarLink(accessToken ?? '', calendarEventId!, recurringEventId),
    enabled: !!calendarEventId,
    staleTime: 60_000,
  })
}

/**
 * Saves (upserts) the issue link for a calendar event.
 * Called after the user successfully submits a worklog via a calendar event.
 */
export function useSaveCalendarLink(calendarEventId: string, recurringEventId?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  return useMutation<CalendarIssueLinkDto, Error, UpsertCalendarIssueLinkDto>({
    mutationFn: (body) => upsertCalendarLink(accessToken ?? '', calendarEventId, { ...body, recurringEventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CALENDAR_LINK_QUERY_KEY(calendarEventId) })
      queryClient.invalidateQueries({ queryKey: ['calendar-links', 'all'] })
    },
  })
}
