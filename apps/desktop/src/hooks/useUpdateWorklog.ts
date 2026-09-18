import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { updateJiraWorklog } from '../services/connectorsClient'
import { JIRA_WORKLOGS_QUERY_KEY } from './useJiraWorklogs'
import { MONTHLY_WORKLOG_ISSUES_QUERY_KEY } from './useMonthlyWorklogIssues'
import { MONTHLY_ISSUE_WORKLOGS_QUERY_KEY } from './useWorklogsByIssue'
import type { UpdateWorklogRequest, UpdateWorklogResponse } from '@houston/shared-types'

interface UpdateWorklogVariables {
  worklogId: string
  body: UpdateWorklogRequest
  previousDate: string
}

export function useUpdateWorklog() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  return useMutation<UpdateWorklogResponse, Error, UpdateWorklogVariables>({
    mutationFn: ({ worklogId, body }) => updateJiraWorklog(accessToken ?? '', worklogId, body),
    onSuccess: async (_data, variables) => {
      const dates = new Set([variables.previousDate, variables.body.date])

      await Promise.all(
        Array.from(dates).flatMap((date) => {
          const [year, month] = date.split('-').map(Number)
          return [
            queryClient.invalidateQueries({ queryKey: JIRA_WORKLOGS_QUERY_KEY(year, month) }),
            queryClient.invalidateQueries({ queryKey: MONTHLY_WORKLOG_ISSUES_QUERY_KEY(year, month) }),
            queryClient.invalidateQueries({
              queryKey: MONTHLY_ISSUE_WORKLOGS_QUERY_KEY(year, month, 'jira', variables.body.issueKey),
            }),
          ]
        }),
      )
    },
  })
}
