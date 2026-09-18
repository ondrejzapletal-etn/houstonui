import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchDailyActivity, type DailyActivityData } from '../services/calendarClient'

export function useDailyActivity(date: string | null, options?: { enabled?: boolean }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const enabled = Boolean(date) && (options?.enabled ?? true)

  return useQuery<DailyActivityData, Error>({
    queryKey: ['dailyActivity', date],
    queryFn: async (): Promise<DailyActivityData> => {
      if (!date) return { sentEmails: [], sentSlackMessages: [] }
      return fetchDailyActivity(accessToken ?? '', date)
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    cacheTime: 30 * 60 * 1000,
  })
}

export default useDailyActivity
