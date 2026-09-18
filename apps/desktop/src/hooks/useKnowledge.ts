import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import {
  fetchKnowledgeEntities,
  fetchKnowledgeEntity,
  fetchKnowledgeGraph,
  fetchKnowledgeObservations,
  fetchKnowledgeEvents,
  searchKnowledgeEntities,
  fetchKnowledgeTasks,
  KnowledgeTaskSummary,
} from '../services/knowledgeClient'

const STALE = 60_000

export function useKnowledgeEntities(type?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'entities', type ?? 'all'],
    queryFn: () => fetchKnowledgeEntities(accessToken, type),
    staleTime: STALE,
  })
}

export function useKnowledgeEntity(id: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'entity', id],
    queryFn: () => fetchKnowledgeEntity(accessToken, id!),
    enabled: !!id,
    staleTime: STALE,
  })
}

export function useKnowledgeGraph(id: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'graph', id],
    queryFn: () => fetchKnowledgeGraph(accessToken, id!),
    enabled: !!id,
    staleTime: STALE,
  })
}

export function useKnowledgeSearch(q: string, type?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'search', q, type ?? 'all'],
    queryFn: () => searchKnowledgeEntities(accessToken, q, type),
    enabled: q.length > 1,
    staleTime: STALE,
  })
}

export function useKnowledgeObservations(entityId?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'observations', entityId ?? 'all'],
    queryFn: () => fetchKnowledgeObservations(accessToken, entityId),
    staleTime: STALE,
  })
}

export function useKnowledgeEvents(entityId?: string) {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['knowledge', 'events', entityId ?? 'all'],
    queryFn: () => fetchKnowledgeEvents(accessToken, entityId),
    staleTime: STALE,
  })
}

export function useKnowledgeTasks() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<KnowledgeTaskSummary[]>({
    queryKey: ['knowledge', 'tasks'],
    queryFn: () => fetchKnowledgeTasks(accessToken),
    staleTime: STALE,
  })
}
