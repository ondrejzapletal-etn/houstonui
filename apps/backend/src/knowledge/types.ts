export type EntityType =
  | 'person'
  | 'task'
  | 'project'
  | 'conversation'
  | 'artifact'
  | 'organization'

export type RelationType =
  | 'RELATED_TO'
  | 'PART_OF'
  | 'BLOCKS'
  | 'DEPENDS_ON'
  | 'MENTIONS'
  | 'DERIVED_FROM'

export interface CreateEntityDto {
  type: EntityType
  title: string
  description?: string
  status?: string
  metadata?: Record<string, unknown>
}

export interface UpdateEntityDto {
  title?: string
  description?: string
  status?: string
  metadata?: Record<string, unknown>
}

export interface CreateRelationDto {
  fromEntityId: string
  toEntityId: string
  relationType: RelationType
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface CreateObservationDto {
  scanRunId?: string
  entityId?: string
  sourceSystem: string
  sourceType: string
  sourceRef: string
  observedAt: Date
  content?: string
  rawPayload?: Record<string, unknown>
}

export interface UpsertFactDto {
  key: string
  value: unknown
  confidence?: number
  source?: string
}
