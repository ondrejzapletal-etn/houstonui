import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchTimeSaved, fetchTimeSavedReport } from '../services/settingsClient'
import type { ReportRange, TimeSavedReport, TimeSavedSummary } from '@houston/shared-types'

export const TIME_SAVED_QUERY_KEY = ['users', 'time-saved'] as const

/**
 * The user's time-saved action counts: last 7 days, last 3 months.
 * Counts only – multiply by the coefficients from the settings store to get seconds.
 */
export function useTimeSaved() {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<TimeSavedSummary, Error>({
    queryKey: TIME_SAVED_QUERY_KEY,
    queryFn: () => fetchTimeSaved(accessToken ?? ''),
    enabled: Boolean(accessToken),
  })
}

export function useTimeSavedReport(range: ReportRange) {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<TimeSavedReport, Error>({
    queryKey: [...TIME_SAVED_QUERY_KEY, 'report', range],
    queryFn: () => fetchTimeSavedReport(accessToken ?? '', range),
    enabled: Boolean(accessToken),
  })
}
