import { useEffect, useMemo } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { fetchIssueSummary } from '../services/projectsClient'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/

function normalizeSummary(summary: string | null | undefined, issueKey: string): string | undefined {
  const normalized = summary?.trim()
  return normalized && normalized.toUpperCase() !== issueKey ? normalized : undefined
}

function combineSummaryData(results: UseQueryResult<string | null>[]) {
  return results.map((result) => result.data)
}

export function useRecentIssueSummaries(knownSummaries: Map<string, string>): Map<string, string> {
  const accessToken = useAuthStore((state) => state.accessToken)
  const recentIssues = useSettingsStore((state) => state.recentJiraIssues)
  const updateSummary = useSettingsStore((state) => state.updateRecentJiraIssueSummary)
  const cachedSummaries = useMemo(() => {
    const summaries = new Map<string, string>()
    for (const issue of recentIssues) {
      const summary = normalizeSummary(issue.summary, issue.key)
        ?? normalizeSummary(knownSummaries.get(issue.key), issue.key)
      if (summary) summaries.set(issue.key, summary)
    }
    return summaries
  }, [recentIssues, knownSummaries])

  const querySummaries = useQueries({
    queries: recentIssues.map((issue) => ({
      queryKey: ['issue-summary', accessToken, issue.key],
      queryFn: () => fetchIssueSummary(accessToken ?? '', issue.key),
      enabled: !!accessToken && !cachedSummaries.has(issue.key) && ISSUE_KEY_PATTERN.test(issue.key),
      staleTime: 5 * 60_000,
      retry: false,
    })),
    combine: combineSummaryData,
  })

  const summaries = useMemo(() => {
    const resolved = new Map(cachedSummaries)
    querySummaries.forEach((data, index) => {
      const key = recentIssues[index].key
      const summary = normalizeSummary(data, key)
      if (summary) resolved.set(key, summary)
    })
    return resolved
  }, [cachedSummaries, querySummaries, recentIssues])

  useEffect(() => {
    if (useAuthStore.getState().accessToken !== accessToken) return
    for (const issue of recentIssues) {
      const summary = summaries.get(issue.key)
      if (summary && summary !== issue.summary) updateSummary(issue.key, summary)
    }
  }, [accessToken, recentIssues, summaries, updateSummary])

  return summaries
}