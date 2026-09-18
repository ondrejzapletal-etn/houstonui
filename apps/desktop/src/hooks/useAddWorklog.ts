import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'
import { addJiraWorklog } from '../services/connectorsClient'
import { JIRA_WORKLOGS_QUERY_KEY } from './useJiraWorklogs'
import { MONTHLY_WORKLOG_ISSUES_QUERY_KEY } from './useMonthlyWorklogIssues'
import { MONTHLY_ISSUE_WORKLOGS_QUERY_KEY } from './useWorklogsByIssue'
import type { AddWorklogRequest, AddWorklogResponse } from '@houston/shared-types'

/**
 * TanStack Query mutation hook for adding a Jira worklog entry.
 *
 * On success, invalidates the worklogs cache for the month matching the
 * logged date so the worklog table auto-refreshes.
 */
export function useAddWorklog() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  return useMutation<AddWorklogResponse, Error, AddWorklogRequest>({
    mutationFn: (body) => addJiraWorklog(accessToken ?? '', body),
    onSuccess: async (_data, variables) => {
      // Derive year/month from the submitted date string "YYYY-MM-DD"
      const [year, month] = variables.date.split('-').map(Number)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: JIRA_WORKLOGS_QUERY_KEY(year, month) }),
        queryClient.invalidateQueries({ queryKey: MONTHLY_WORKLOG_ISSUES_QUERY_KEY(year, month) }),
        queryClient.invalidateQueries({
          queryKey: MONTHLY_ISSUE_WORKLOGS_QUERY_KEY(year, month, 'jira', variables.issueKey),
        }),
      ])
      // Track recently used Jira issues (persisted to localStorage)
      useSettingsStore.getState().addRecentJiraIssue(variables.issueKey)
    },
  })
}
