import { useQuery } from '@tanstack/react-query'
import type { MonthlyWorklogIssueEntry } from '@houston/shared-types'
import { useAuthStore } from '../store/authStore'
import { fetchMonthlyWorklogIssues } from '../services/connectorsClient'

export const MONTHLY_WORKLOG_ISSUES_QUERY_KEY = (year: number, month: number) =>
  ['monthly-worklog-issues', year, month] as const

interface UseMonthlyWorklogIssuesParams {
  year: number
  month: number
  enabled: boolean
}

interface UseMonthlyWorklogIssuesResult {
  issues: MonthlyWorklogIssueEntry[]
  isLoading: boolean
  isError: boolean
}

export function useMonthlyWorklogIssues({
  year,
  month,
  enabled,
}: UseMonthlyWorklogIssuesParams): UseMonthlyWorklogIssuesResult {
  const accessToken = useAuthStore((s) => s.accessToken)

  const { data, isLoading, isError } = useQuery({
    queryKey: MONTHLY_WORKLOG_ISSUES_QUERY_KEY(year, month),
    queryFn: () => fetchMonthlyWorklogIssues(accessToken ?? '', year, month),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  return {
    issues: data?.issues ?? [],
    isLoading,
    isError,
  }
}
