import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchAiSettings, fetchAiUsage, fetchAiUsageReport, updateAiSettings } from '../services/settingsClient'
import type { AiProviderName, AiSettings, AiUsageReport, AiUsageSummary, ReportRange } from '@houston/shared-types'

export const AI_SETTINGS_QUERY_KEY = ['settings', 'ai'] as const
export const AI_USAGE_QUERY_KEY = ['settings', 'ai', 'usage'] as const

/** The user's server-side AI provider settings. */
export function useAiSettings() {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<AiSettings, Error>({
    queryKey: AI_SETTINGS_QUERY_KEY,
    queryFn: () => fetchAiSettings(accessToken ?? ''),
    enabled: Boolean(accessToken),
  })
}

/** The user's LLM token/cost usage: last 7 days, last 3 months. */
export function useAiUsage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<AiUsageSummary, Error>({
    queryKey: AI_USAGE_QUERY_KEY,
    queryFn: () => fetchAiUsage(accessToken ?? ''),
    enabled: Boolean(accessToken),
  })
}

export function useAiUsageReport(range: ReportRange) {
  const accessToken = useAuthStore((s) => s.accessToken)

  return useQuery<AiUsageReport, Error>({
    queryKey: [...AI_USAGE_QUERY_KEY, range],
    queryFn: () => fetchAiUsageReport(accessToken ?? '', range),
    enabled: Boolean(accessToken),
  })
}

/** Saves the provider choice. `null` reverts to the server default. */
export function useUpdateAiSettings() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  return useMutation<AiSettings, Error, AiProviderName | null>({
    mutationFn: (aiProvider) => updateAiSettings(accessToken ?? '', { aiProvider }),
    // The response is the fresh settings – seed the cache with it rather than
    // triggering another round trip.
    onSuccess: (data) => queryClient.setQueryData(AI_SETTINGS_QUERY_KEY, data),
  })
}
