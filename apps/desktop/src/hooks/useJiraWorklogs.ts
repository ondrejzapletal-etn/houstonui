import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchJiraWorklogs } from '../services/connectorsClient'
import { useConnectors } from './useConnectors'
import type { JiraWorklogResponse } from '@houston/shared-types'

const WORKLOG_MONTH_STORAGE_KEY = 'houston.dashboard.worklogs.month'

type YearMonth = {
  year: number
  month: number
}

function getDefaultYearMonth(): YearMonth {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  }
}

function getInitialYearMonth(): YearMonth {
  const fallback = getDefaultYearMonth()
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(WORKLOG_MONTH_STORAGE_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<YearMonth>
    const year = Number(parsed.year)
    const month = Number(parsed.month)

    if (!Number.isInteger(year) || !Number.isInteger(month)) return fallback
    if (month < 1 || month > 12) return fallback

    return { year, month }
  } catch {
    return fallback
  }
}

export const JIRA_WORKLOGS_QUERY_KEY = (year: number, month: number) =>
  ['jira-worklogs', year, month] as const

export interface UseJiraWorklogsResult {
  secondsPerDay: Record<number, number>
  year: number
  month: number
  isLoading: boolean
  isError: boolean
  isJiraConnected: boolean
  prevMonth: () => void
  nextMonth: () => void
}

export function useJiraWorklogs(): UseJiraWorklogsResult {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { connectors } = useConnectors()

  const [yearMonth, setYearMonth] = useState<YearMonth>(getInitialYearMonth)
  const { year, month } = yearMonth

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WORKLOG_MONTH_STORAGE_KEY, JSON.stringify({ year, month }))
  }, [year, month])

  const isJiraConnected =
    connectors.find((c) => c.id === 'jira')?.status === 'connected'

  const { data, isLoading, isError } = useQuery<JiraWorklogResponse>({
    queryKey: JIRA_WORKLOGS_QUERY_KEY(year, month),
    queryFn: () => fetchJiraWorklogs(accessToken ?? '', year, month),
    enabled: isJiraConnected,
    staleTime: 5 * 60 * 1000,
  })

  function prevMonth(): void {
    setYearMonth((current) =>
      current.month === 1
        ? { year: current.year - 1, month: 12 }
        : { year: current.year, month: current.month - 1 },
    )
  }

  function nextMonth(): void {
    setYearMonth((current) =>
      current.month === 12
        ? { year: current.year + 1, month: 1 }
        : { year: current.year, month: current.month + 1 },
    )
  }

  return {
    secondsPerDay: data?.secondsPerDay ?? {},
    year,
    month,
    isLoading: isJiraConnected && isLoading,
    isError,
    isJiraConnected,
    prevMonth,
    nextMonth,
  }
}
