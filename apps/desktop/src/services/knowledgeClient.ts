import { API_BASE_URL } from '../config/api'

export interface KnowledgeEntity {
  id: string
  userId: string
  type: string
  title: string
  description: string | null
  status: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface KnowledgeFact {
  id: string
  entityId: string
  key: string
  value: unknown
  confidence: number
  source: string | null
  updatedAt: string
}

export interface KnowledgeRelation {
  id: string
  fromEntityId: string
  toEntityId: string
  relationType: string
  confidence: number
  metadata: Record<string, unknown>
  createdAt: string
  fromEntity?: KnowledgeEntity
  toEntity?: KnowledgeEntity
}

export interface KnowledgeObservation {
  id: string
  sourceSystem: string
  sourceType: string
  sourceRef: string
  observedAt: string
  content: string | null
  processed: boolean
  createdAt: string
}

export interface KnowledgeEvent {
  id: string
  entityId: string | null
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface KnowledgeDerivedState {
  summary: string | null
  insights: string[] | null
  urgencyScore: number | null
  riskScore: number | null
  computedAt: string
  invalidated: boolean
}

export interface KnowledgeTaskSummary {
  id: string
  title: string
  description: string | null
  status: string | null
  updatedAt: string
  facts: KnowledgeFact[]
  observations: Array<{ observedAt: string; sourceSystem: string; content: string | null }>
  derivedState: { urgencyScore: number | null; riskScore: number | null; invalidated: boolean } | null
  outgoingRelations: Array<{ relationType: string; toEntity: { id: string; type: string; title: string } }>
}

export interface KnowledgeEntityDetail extends KnowledgeEntity {
  facts: KnowledgeFact[]
  derivedState: KnowledgeDerivedState | null
  externalLinks: { id: string; sourceSystem: string; sourceType: string; sourceRef: string }[]
}

export interface KnowledgeGraph {
  entity: KnowledgeEntityDetail
  outgoing: KnowledgeRelation[]
  incoming: KnowledgeRelation[]
}

function authHeaders(accessToken: string | null): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`
  return h
}

export async function fetchKnowledgeEntities(
  accessToken: string | null,
  type?: string,
): Promise<KnowledgeEntity[]> {
  const url = new URL(`${API_BASE_URL}/knowledge/entities`)
  if (type) url.searchParams.set('type', type)
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error(`Knowledge entities fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.entities
}

export async function fetchKnowledgeEntity(
  accessToken: string | null,
  id: string,
): Promise<KnowledgeEntityDetail> {
  const res = await fetch(`${API_BASE_URL}/knowledge/entities/${id}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error(`Knowledge entity fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.entity
}

export async function fetchKnowledgeGraph(
  accessToken: string | null,
  id: string,
): Promise<KnowledgeGraph> {
  const res = await fetch(`${API_BASE_URL}/knowledge/entities/${id}/graph`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error(`Knowledge graph fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data
}

export async function searchKnowledgeEntities(
  accessToken: string | null,
  q: string,
  type?: string,
): Promise<KnowledgeEntity[]> {
  const url = new URL(`${API_BASE_URL}/knowledge/search`)
  url.searchParams.set('q', q)
  if (type) url.searchParams.set('type', type)
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error(`Knowledge search failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.entities
}

export async function fetchKnowledgeObservations(
  accessToken: string | null,
  entityId?: string,
): Promise<KnowledgeObservation[]> {
  const url = new URL(`${API_BASE_URL}/knowledge/observations`)
  if (entityId) url.searchParams.set('entityId', entityId)
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error(`Knowledge observations fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.observations
}

export async function syncKnowledgeDomainData(accessToken: string | null): Promise<{ clients: number; projects: number; issues: number }> {
  const res = await fetch(`${API_BASE_URL}/knowledge/sync`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error(`Knowledge sync failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data
}

export async function fetchKnowledgeEvents(
  accessToken: string | null,
  entityId?: string,
): Promise<KnowledgeEvent[]> {
  const url = new URL(`${API_BASE_URL}/knowledge/events`)
  if (entityId) url.searchParams.set('entityId', entityId)
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error(`Knowledge events fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.events
}

export async function fetchKnowledgeTasks(accessToken: string | null): Promise<KnowledgeTaskSummary[]> {
  const res = await fetch(`${API_BASE_URL}/knowledge/tasks`, { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error(`Knowledge tasks fetch failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data.tasks
}

export async function enrichTasksFromJira(accessToken: string | null): Promise<{ enriched: number }> {
  const res = await fetch(`${API_BASE_URL}/issues/enrich-kg`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error(`Task enrichment failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.data
}
