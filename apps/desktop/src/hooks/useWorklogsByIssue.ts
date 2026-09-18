import { useQuery } from '@tanstack/react-query'
import type { MonthlyIssueWorklogEntry } from '@houston/shared-types'
import { useAuthStore } from '../store/authStore'
import { fetchMonthlyIssueWorklogs } from '../services/connectorsClient'

export const MONTHLY_ISSUE_WORKLOGS_QUERY_KEY = (
  year: number,
  month: number,
  source: 'jira' | 'clockify',
  reference: string,
) => ['monthly-issue-worklogs', year, month, source, reference] as const

interface UseWorklogsByIssueParams {
  year: number
  month: number
  source: 'jira' | 'clockify'
  reference: string
  enabled: boolean
}

interface UseWorklogsByIssueResult {
  worklogs: MonthlyIssueWorklogEntry[]
  isLoading: boolean
  isError: boolean
}

export function useWorklogsByIssue({
  year,
  month,
  source,
  reference,
  enabled,
}: UseWorklogsByIssueParams): UseWorklogsByIssueResult {
  const accessToken = useAuthStore((s) => s.accessToken)

  const { data, isLoading, isError } = useQuery({
    queryKey: MONTHLY_ISSUE_WORKLOGS_QUERY_KEY(year, month, source, reference),
    queryFn: () => fetchMonthlyIssueWorklogs(accessToken ?? '', year, month, source, reference),
    enabled: enabled && reference.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  })

  return {
    worklogs: data?.worklogs ?? [],
    isLoading,
    isError,
  }
}
