import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchCalendarRange } from '../services/calendarClient'
import type { ContextCalendarEvent } from '@houston/shared-types'

function dayWindowIso(date: string) {
  // date expected in YYYY-MM-DD
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(`${date}T23:59:59.999`)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}

export function useCalendarEvents(date: string | null, options?: { enabled?: boolean }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const enabled = Boolean(date) && (options?.enabled ?? true)

  return useQuery<ContextCalendarEvent[], Error>({
    queryKey: ['calendarEvents', date],
    queryFn: async () => {
      if (!date) return []
      const { timeMin, timeMax } = dayWindowIso(date)
      const res = await fetchCalendarRange(accessToken ?? '', timeMin, timeMax)
      return res.events ?? res
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
  })
}

export function useDashboardCalendarEvents() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const to = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1)

  return useQuery<ContextCalendarEvent[], Error>({
    queryKey: ['dashboardCalendarEvents', from.toISOString().slice(0, 10)],
    queryFn: async () => {
      const result = await fetchCalendarRange(accessToken ?? '', from.toISOString(), to.toISOString())
      return result.events ?? result
    },
    staleTime: 2 * 60 * 1000,
  })
}

export default useCalendarEvents
