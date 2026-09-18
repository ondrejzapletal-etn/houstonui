import { useQuery } from '@tanstack/react-query'
import type {
  ConnectorType,
  SourcePreviewEmail,
  SourcePreviewSlackChannel,
} from '@houston/shared-types'
import { useAuthStore } from '../store/authStore'
import { fetchGmailPreview, fetchSlackPreview } from '../services/sourcePreviewClient'
import {
  fetchClockifyWorklogsDay,
  fetchJiraWorklogsDay,
} from '../services/connectorsClient'

/** Jeden řádek v seznamu worklogů (Jira i Clockify se normalizují do stejného tvaru). */
export interface SourcePreviewWorklogEntry {
  id: string
  title: string
  detail?: string
  seconds: number
}

export type SourcePreviewData =
  | { kind: 'gmail'; emails: SourcePreviewEmail[]; error?: string }
  | { kind: 'slack'; channels: SourcePreviewSlackChannel[]; error?: string }
  | { kind: 'worklogs'; date: string; entries: SourcePreviewWorklogEntry[] }
  | { kind: 'unavailable' }

export interface UseSourcePreviewResult {
  data: SourcePreviewData | null
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  refetch: () => void
  isFetching: boolean
}

export const SOURCE_PREVIEW_QUERY_KEY = 'sourcePreview'

/** Dnešní datum jako YYYY-MM-DD v lokální zóně (ne UTC – worklogy jsou lokální). */
function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function loadPreview(type: ConnectorType, accessToken: string): Promise<SourcePreviewData> {
  switch (type) {
    case 'gmail': {
      const data = await fetchGmailPreview(accessToken)
      return { kind: 'gmail', emails: data.emails, error: data.error }
    }
    case 'slack': {
      const data = await fetchSlackPreview(accessToken)
      return { kind: 'slack', channels: data.channels, error: data.error }
    }
    case 'jira': {
      const date = todayKey()
      const { worklogs } = await fetchJiraWorklogsDay(accessToken, date)
      return {
        kind: 'worklogs',
        date,
        entries: worklogs.map((w) => ({
          id: w.id,
          title: w.issueName ? `${w.issueId} — ${w.issueName}` : w.issueId,
          detail: w.comment,
          seconds: w.timeSpentSeconds,
        })),
      }
    }
    case 'clockify': {
      const date = todayKey()
      const { worklogs } = await fetchClockifyWorklogsDay(accessToken, date)
      return {
        kind: 'worklogs',
        date,
        entries: worklogs.map((w) => ({
          id: w.id,
          title: w.project ?? 'Bez projektu',
          detail: w.description,
          seconds: w.timeSpentSeconds,
        })),
      }
    }
    default:
      // HotSpot vrací z backendu jen agregované sekundy – obsah k zobrazení není.
      return { kind: 'unavailable' }
  }
}

/**
 * Načte obsah jednoho zdroje pro náhledový modál. Dotaz se spustí jen pro
 * `type !== null`, takže modál načítá výhradně zdroj, který uživatel otevřel.
 */
export function useSourcePreview(type: ConnectorType | null): UseSourcePreviewResult {
  const accessToken = useAuthStore((s) => s.accessToken)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [SOURCE_PREVIEW_QUERY_KEY, type],
    queryFn: () => loadPreview(type as ConnectorType, accessToken ?? ''),
    enabled: type !== null,
    staleTime: 60 * 1000,
  })

  return {
    data: data ?? null,
    // `isLoading` je u disabled dotazu true – pro zavřený modál to nechceme.
    isLoading: type !== null && isLoading,
    isError,
    errorMessage: isError && error instanceof Error ? error.message : null,
    refetch,
    isFetching,
  }
}
