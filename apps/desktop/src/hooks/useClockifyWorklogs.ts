import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchClockifyWorklogs } from '../services/connectorsClient'
import { useConnectors } from './useConnectors'
import type { ClockifyWorklogResponse } from '@houston/shared-types'

export const CLOCKIFY_WORKLOGS_QUERY_KEY = (year: number, month: number) =>
  ['clockify-worklogs', year, month] as const

export interface UseClockifyWorklogsParams {
  year: number
  month: number
}

export interface UseClockifyWorklogsResult {
  secondsPerDay: Record<number, number>
  isLoading: boolean
  isError: boolean
  isClockifyConnected: boolean
}

/**
 * Fetches per-day Clockify worklog seconds for the given year/month.
 *
 * Month navigation state is intentionally NOT owned by this hook –
 * it is owned by useJiraWorklogs and passed in as params so both
 * hooks share a single source of truth for the selected month.
 */
export function useClockifyWorklogs({ year, month }: UseClockifyWorklogsParams): UseClockifyWorklogsResult {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { connectors } = useConnectors()

  const isClockifyConnected =
    connectors.find((c) => c.id === 'clockify')?.status === 'connected'

  const { data, isLoading, isError } = useQuery<ClockifyWorklogResponse>({
    queryKey: CLOCKIFY_WORKLOGS_QUERY_KEY(year, month),
    queryFn: () => fetchClockifyWorklogs(accessToken ?? '', year, month),
    enabled: isClockifyConnected,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return {
    secondsPerDay: data?.secondsPerDay ?? {},
    isLoading: isClockifyConnected && isLoading,
    isError,
    isClockifyConnected,
  }
}
