import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { searchIssues } from '../services/projectsClient'
import type { JiraIssueDto } from '@houston/shared-types'

/**
 * Searches the local Jira issue cache for autocomplete suggestions.
 * Queries are debounced by TanStack Query's staleTime.
 */
export function useIssueSearch(search: string, projectId?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<JiraIssueDto[]>({
    queryKey: ['issues', 'search', search, projectId],
    queryFn: () => searchIssues(accessToken ?? '', search || undefined, projectId),
    enabled: !!accessToken,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}
