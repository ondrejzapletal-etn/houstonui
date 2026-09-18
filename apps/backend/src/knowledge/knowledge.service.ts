import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  CreateEntityDto,
  CreateObservationDto,
  CreateRelationDto,
  UpdateEntityDto,
  UpsertFactDto,
} from './types'

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ── Entities ──────────────────────────────────────────────────────────────

  async listEntities(userId: string, type?: string) {
    return this.prisma.knowledgeEntity.findMany({
      where: { userId, ...(type ? { type } : {}) },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async getEntity(id: string, userId: string) {
    const entity = await this.prisma.knowledgeEntity.findUnique({
      where: { id },
      include: {
        facts: true,
        derivedState: true,
        externalLinks: true,
      },
    })
    if (!entity) throw new NotFoundException(`Entity ${id} not found`)
    if (entity.userId !== userId) throw new ForbiddenException('Access denied')
    return entity
  }

  async getEntityGraph(id: string, userId: string) {
    const entity = await this.getEntity(id, userId)
    const [outgoing, incoming] = await Promise.all([
      this.prisma.knowledgeRelation.findMany({
        where: { fromEntityId: id, userId },
        include: { toEntity: true },
      }),
      this.prisma.knowledgeRelation.findMany({
        where: { toEntityId: id, userId },
        include: { fromEntity: true },
      }),
    ])
    return { entity, outgoing, incoming }
  }

  async searchEntities(userId: string, q: string, type?: string) {
    return this.prisma.knowledgeEntity.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
  }

  async createEntity(userId: string, dto: CreateEntityDto) {
    const entity = await this.prisma.knowledgeEntity.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        status: dto.status,
        metadata: (dto.metadata ?? {}) as object,
      },
    })
    await this.appendEvent(userId, entity.id, 'entity_created', { type: dto.type, title: dto.title })
    this.logger.log(`Entity created id=${entity.id} type=${dto.type} userId=${userId}`)
    return entity
  }

  async updateEntity(id: string, userId: string, dto: UpdateEntityDto) {
    await this.assertOwned(id, userId)
    const entity = await this.prisma.knowledgeEntity.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.metadata !== undefined ? { metadata: dto.metadata as object } : {}),
      },
    })
    await this.invalidateDerivedState(id)
    await this.appendEvent(userId, id, 'entity_updated', dto as object)
    return entity
  }

  async deleteEntity(id: string, userId: string) {
    await this.assertOwned(id, userId)
    await this.prisma.knowledgeEntity.delete({ where: { id } })
    this.logger.log(`Entity deleted id=${id} userId=${userId}`)
  }

  // ── Entity resolution ──────────────────────────────────────────────────────

  async resolveEntity(
    userId: string,
    sourceSystem: string,
    sourceType: string,
    sourceRef: string,
    defaults: CreateEntityDto,
  ) {
    const link = await this.prisma.knowledgeExternalLink.findUnique({
      where: { sourceSystem_sourceType_sourceRef: { sourceSystem, sourceType, sourceRef } },
      include: { entity: true },
    })
    if (link) return link.entity

    const entity = await this.createEntity(userId, defaults)
    await this.prisma.knowledgeExternalLink.create({
      data: { entityId: entity.id, sourceSystem, sourceType, sourceRef },
    })
    return entity
  }

  // ── Relations ──────────────────────────────────────────────────────────────

  async createRelation(userId: string, dto: CreateRelationDto) {
    const relation = await this.prisma.knowledgeRelation.upsert({
      where: {
        fromEntityId_toEntityId_relationType: {
          fromEntityId: dto.fromEntityId,
          toEntityId: dto.toEntityId,
          relationType: dto.relationType,
        },
      },
      create: {
        userId,
        fromEntityId: dto.fromEntityId,
        toEntityId: dto.toEntityId,
        relationType: dto.relationType,
        confidence: dto.confidence ?? 1.0,
        metadata: (dto.metadata ?? {}) as object,
      },
      update: {
        confidence: dto.confidence ?? 1.0,
      },
    })
    await this.appendEvent(userId, dto.fromEntityId, 'relation_added', {
      toEntityId: dto.toEntityId,
      relationType: dto.relationType,
    })
    return relation
  }

  // ── Observations ───────────────────────────────────────────────────────────

  async addObservation(userId: string, dto: CreateObservationDto) {
    return this.prisma.knowledgeObservation.create({
      data: {
        userId,
        scanRunId: dto.scanRunId,
        entityId: dto.entityId,
        sourceSystem: dto.sourceSystem,
        sourceType: dto.sourceType,
        sourceRef: dto.sourceRef,
        observedAt: dto.observedAt,
        content: dto.content,
        rawPayload: (dto.rawPayload ?? {}) as object,
      },
    })
  }

  async listObservations(userId: string, entityId?: string) {
    return this.prisma.knowledgeObservation.findMany({
      where: { userId, ...(entityId ? { entityId } : {}) },
      orderBy: { observedAt: 'desc' },
      take: 100,
    })
  }

  // ── Facts ──────────────────────────────────────────────────────────────────

  async upsertFact(entityId: string, userId: string, dto: UpsertFactDto) {
    await this.assertOwned(entityId, userId)
    const fact = await this.prisma.knowledgeFact.upsert({
      where: { entityId_key: { entityId, key: dto.key } },
      create: {
        entityId,
        key: dto.key,
        value: dto.value as object,
        confidence: dto.confidence ?? 1.0,
        source: dto.source,
      },
      update: {
        value: dto.value as object,
        confidence: dto.confidence ?? 1.0,
        source: dto.source,
      },
    })
    await this.invalidateDerivedState(entityId)
    await this.appendEvent(userId, entityId, 'fact_updated', { key: dto.key, value: dto.value })
    return fact
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async listEvents(userId: string, entityId?: string) {
    return this.prisma.knowledgeEvent.findMany({
      where: { userId, ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  private async invalidateDerivedState(entityId: string) {
    await this.prisma.knowledgeDerivedState.updateMany({
      where: { entityId, invalidated: false },
      data: { invalidated: true },
    })
  }

  // ── Classifier context ─────────────────────────────────────────────────────

  /**
   * Returns a compact KG summary for use in the scan classifier prompt.
   * Keeps tokens low: only person contacts + open tasks with key facts.
   */
  async getClassifierContext(userId: string): Promise<{
    contacts: { name: string; email?: string; organization?: string }[]
    tasks: { issueKey: string; summary: string; status?: string }[]
    recentOutcomes: { title: string; proposalStatus: string; tier: number }[]
  }> {
    const [personEntities, taskEntities, recentConversations] = await Promise.all([
      this.prisma.knowledgeEntity.findMany({
        where: { userId, type: 'person' },
        include: { facts: { where: { key: { in: ['email', 'organization'] } } } },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeEntity.findMany({
        where: { userId, type: 'task', status: { not: 'closed' } },
        include: { facts: { where: { key: { in: ['issueKey', 'summary'] } } } },
        take: 50,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeEntity.findMany({
        where: { userId, type: 'conversation' },
        include: {
          facts: { where: { key: { in: ['proposal_status', 'tier'] } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ])

    const contacts = personEntities.map((e) => ({
      name: e.title,
      email: e.facts.find((f) => f.key === 'email')?.value as string | undefined,
      organization: e.facts.find((f) => f.key === 'organization')?.value as string | undefined,
    }))

    const tasks = taskEntities.map((e) => ({
      issueKey: (e.facts.find((f) => f.key === 'issueKey')?.value as string) ?? e.title,
      summary: (e.facts.find((f) => f.key === 'summary')?.value as string) ?? e.title,
      status: e.status ?? undefined,
    }))

    const recentOutcomes = recentConversations
      .filter((e) => e.facts.some((f) => f.key === 'proposal_status'))
      .map((e) => ({
        title: e.title,
        proposalStatus: e.facts.find((f) => f.key === 'proposal_status')?.value as string,
        tier: (e.facts.find((f) => f.key === 'tier')?.value as number) ?? 0,
      }))

    return { contacts, tasks, recentOutcomes }
  }

  // ── Dashboard tasks ────────────────────────────────────────────────────────

  async listTasksForDashboard(userId: string) {
    const tasks = await this.prisma.knowledgeEntity.findMany({
      where: { userId, type: 'task', status: { not: 'closed' } },
      include: {
        facts: true,
        observations: { orderBy: { observedAt: 'desc' }, take: 1 },
        derivedState: true,
        outgoingRelations: {
          where: { relationType: 'PART_OF' },
          include: { toEntity: true },
          take: 1,
        },
      },
      take: 50,
    })
    return tasks.sort((a, b) => {
      const sa = (!a.derivedState?.invalidated ? a.derivedState?.urgencyScore : null) ?? -1
      const sb = (!b.derivedState?.invalidated ? b.derivedState?.urgencyScore : null) ?? -1
      if (Math.abs(sa - sb) > 0.01) return sb - sa
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }

  // ── Internal helpers (no ownership check — caller guarantees trust) ────────

  /** Find entity by external system link. Returns null if not found — never throws. */
  async findByExternalLink(
    sourceSystem: string,
    sourceType: string,
    sourceRef: string,
  ) {
    const link = await this.prisma.knowledgeExternalLink.findUnique({
      where: { sourceSystem_sourceType_sourceRef: { sourceSystem, sourceType, sourceRef } },
      include: { entity: true },
    })
    return link?.entity ?? null
  }

  /** Upsert a fact without an ownership check — for trusted internal ingestion flows. */
  async upsertFactInternal(
    entityId: string,
    key: string,
    value: unknown,
    source?: string,
  ): Promise<void> {
    await this.prisma.knowledgeFact.upsert({
      where: { entityId_key: { entityId, key } },
      create: { entityId, key, value: value as object, confidence: 1.0, source },
      update: { value: value as object, source },
    })
    await this.invalidateDerivedState(entityId)
  }

  /** Append an event without an ownership check — for trusted internal flows. */
  async appendEventInternal(
    userId: string,
    entityId: string | null,
    eventType: string,
    payload: object,
  ): Promise<void> {
    await this.appendEvent(userId, entityId, eventType, payload)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertOwned(entityId: string, userId: string) {
    const entity = await this.prisma.knowledgeEntity.findUnique({ where: { id: entityId } })
    if (!entity) throw new NotFoundException(`Entity ${entityId} not found`)
    if (entity.userId !== userId) throw new ForbiddenException('Access denied')
    return entity
  }

  private async appendEvent(
    userId: string,
    entityId: string | null,
    eventType: string,
    payload: object,
  ) {
    await this.prisma.knowledgeEvent.create({
      data: { userId, entityId, eventType, payload },
    })
  }
}
