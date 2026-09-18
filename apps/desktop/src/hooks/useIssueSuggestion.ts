import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchIssueSuggestion, type IssueSuggestion } from '../services/projectsClient'

export function useIssueSuggestion(emails: string[] | undefined) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const validEmails = (emails ?? []).filter(Boolean)

  return useQuery<IssueSuggestion>({
    queryKey: ['issue-suggestion', ...validEmails.sort()],
    queryFn: () => fetchIssueSuggestion(accessToken ?? '', validEmails),
    enabled: !!accessToken && validEmails.length > 0,
    staleTime: 5 * 60_000,
  })
}
