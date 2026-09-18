import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchContext } from '../services/contextClient'
import type { ContextData } from '@houston/shared-types'

export const CONTEXT_QUERY_KEY = ['context'] as const

export interface UseContextResult {
  data: ContextData | null
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  refetch: () => void
  isFetching: boolean
}

export function useContext(): UseContextResult {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: CONTEXT_QUERY_KEY,
    queryFn: () => fetchContext(accessToken ?? ''),
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

  return {
    data: data ?? null,
    isLoading,
    isError,
    errorMessage: isError && error instanceof Error ? error.message : null,
    refetch,
    isFetching,
  }
}
