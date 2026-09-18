import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { addClockifyWorklog } from '../services/connectorsClient'
import { CLOCKIFY_WORKLOGS_QUERY_KEY } from './useClockifyWorklogs'
import type { AddClockifyWorklogRequest, AddClockifyWorklogResponse } from '@houston/shared-types'

export function useAddClockifyWorklog() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  return useMutation<AddClockifyWorklogResponse, Error, AddClockifyWorklogRequest>({
    mutationFn: (body) => addClockifyWorklog(accessToken ?? '', body),
    onSuccess: (_data, variables) => {
      const [year, month] = variables.date.split('-').map(Number)
      queryClient.invalidateQueries({ queryKey: CLOCKIFY_WORKLOGS_QUERY_KEY(year, month) })
    },
  })
}
