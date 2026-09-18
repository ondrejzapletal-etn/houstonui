/**
 * IssuesService
 *
 * Manages the local cache of Jira issues (user-specific).
 * Issues are populated on first use (when user assigns an issue to a calendar
 * event or a proposal is approved). No background sync – sync is on-demand.
 *
 * Key behaviour:
 * - upsertFromKey: idempotent insert/update; auto-resolves the Project by
 *   extracting the Jira project key prefix from the issue key (e.g. "PROJ-123"
 *   → looks for Project with jiraProjectKey = "PROJ").
 * - search: full-text style search over issueKey + summary for autocomplete.
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectsService } from '../projects/projects.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { JiraService } from '../connectors/jira/jira.service'
import { UpsertJiraIssueDto, IssueSearchQuery } from './dto/issue.dto'

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly knowledge: KnowledgeService,
    private readonly jira: JiraService,
  ) {}

  async search(userId: string, query: IssueSearchQuery) {
    const { search, projectId, includeInactive } = query
    return this.prisma.jiraIssue.findMany({
      where: {
        userId,
        ...(includeInactive ? {} : { active: true }),
        ...(projectId ? { projectId } : {}),
        ...(search
          ? {
              OR: [
                { issueKey: { contains: search, mode: 'insensitive' } },
                { summary: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { issueKey: 'asc' },
      take: 50,
    })
  }

  /**
   * Upsert a Jira issue into the local cache.
   * If `projectId` is not supplied, attempts to resolve it automatically
   * by extracting the project key prefix from the issue key.
   */
  async upsertFromKey(
    userId: string,
    dto: UpsertJiraIssueDto,
  ) {
    const resolvedProjectId = dto.projectId ?? (await this.resolveProjectId(userId, dto.issueKey))

    const issue = await this.prisma.jiraIssue.upsert({
      where: { userId_issueKey: { userId, issueKey: dto.issueKey } },
      create: {
        userId,
        issueKey: dto.issueKey,
        summary: dto.summary,
        projectId: resolvedProjectId ?? null,
        lastSyncedAt: new Date(),
      },
      update: {
        summary: dto.summary,
        projectId: resolvedProjectId ?? undefined,
        lastSyncedAt: new Date(),
        active: true,
      },
    })
    this.logger.debug(`Upserted issue ${issue.issueKey} userId=${userId}`)
    void this.syncIssueEntity(userId, issue.issueKey, issue.summary, resolvedProjectId ?? null)
    return issue
  }

  private async syncIssueEntity(
    userId: string,
    issueKey: string,
    summary: string,
    projectId: string | null,
  ): Promise<void> {
    try {
      const entity = await this.knowledge.resolveEntity(userId, 'jira', 'issue', issueKey, {
        type: 'task',
        title: summary,
        status: 'open',
      })
      await this.knowledge.upsertFactInternal(entity.id, 'issueKey', issueKey, 'jira')
      await this.knowledge.upsertFactInternal(entity.id, 'summary', summary, 'jira')
      if (projectId) {
        const projectEntity = await this.knowledge.findByExternalLink('internal', 'project', projectId)
        if (projectEntity) {
          await this.knowledge.createRelation(userId, {
            fromEntityId: entity.id,
            toEntityId: projectEntity.id,
            relationType: 'PART_OF',
          }).catch(() => {})
        }
      }
      void this.enrichTaskEntity(userId, issueKey, entity.id)
    } catch (err) {
      this.logger.warn(`KG issue sync: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Enrich a task entity with full Jira issue details (status, priority, assignee, reporter, etc.).
   * entityId is optional — if omitted, looks up the entity by external link.
   */
  private async enrichTaskEntity(userId: string, issueKey: string, entityId?: string): Promise<void> {
    try {
      const details = await this.jira.getIssueDetails(userId, issueKey)
      if (!details) return

      const entityRef = entityId
        ? { id: entityId }
        : await this.knowledge.findByExternalLink('jira', 'issue', issueKey)
      if (!entityRef) return

      await this.knowledge.updateEntity(entityRef.id, userId, { status: details.status })

      const facts: Promise<void>[] = [
        this.knowledge.upsertFactInternal(entityRef.id, 'status', details.status, 'jira'),
        this.knowledge.upsertFactInternal(entityRef.id, 'source', 'jira', 'jira'),
        this.knowledge.upsertFactInternal(entityRef.id, 'jiraIssueKey', details.key, 'jira'),
      ]
      if (details.updatedAt) facts.push(this.knowledge.upsertFactInternal(entityRef.id, 'jiraUpdatedAt', details.updatedAt, 'jira'))
      if (details.priority) facts.push(this.knowledge.upsertFactInternal(entityRef.id, 'priority', details.priority, 'jira'))
      if (details.duedate) facts.push(this.knowledge.upsertFactInternal(entityRef.id, 'duedate', details.duedate, 'jira'))
      if (details.labels.length > 0) facts.push(this.knowledge.upsertFactInternal(entityRef.id, 'labels', details.labels.join(', '), 'jira'))

      for (const role of ['assignee', 'reporter'] as const) {
        const person = details[role]
        if (!person) continue
        facts.push(this.knowledge.upsertFactInternal(entityRef.id, role, person.displayName, 'jira'))
        facts.push(
          this.knowledge.resolveEntity(userId, 'jira', 'person', person.email, {
            type: 'person',
            title: person.displayName,
          }).then(async (personEntity) => {
            await this.knowledge.upsertFactInternal(personEntity.id, 'email', person.email, 'jira')
            await this.knowledge.createRelation(userId, {
              fromEntityId: entityRef.id,
              toEntityId: personEntity.id,
              relationType: 'MENTIONS',
            }).catch(() => {})
          }),
        )
      }

      await Promise.all(facts)

      // Upsert current Jira state as a stable observation (delete-then-insert for idempotency)
      const statusLabel: Record<string, string> = { 'todo': 'Nový', 'in-progress': 'V řešení', 'done': 'Hotovo', 'blocked': 'Blokován' }
      const content = [
        statusLabel[details.status] ?? details.status,
        details.assignee ? `řešitel: ${details.assignee.displayName}` : null,
        details.priority ? `priorita: ${details.priority}` : null,
      ].filter(Boolean).join(' · ')
      const observedAt = details.updatedAt ? new Date(details.updatedAt) : new Date()
      await this.prisma.knowledgeObservation.deleteMany({
        where: { entityId: entityRef.id, sourceSystem: 'jira', sourceType: 'issue_state' },
      })
      await this.knowledge.addObservation(userId, {
        entityId: entityRef.id,
        sourceSystem: 'jira',
        sourceType: 'issue_state',
        sourceRef: details.key,
        observedAt,
        content,
      })

      this.logger.debug(`KG task enriched ${issueKey}`)
    } catch (err) {
      this.logger.warn(`KG task enrich failed ${issueKey}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Bulk-enrich all active cached Jira issues with full details from Jira API.
   * Runs sequentially to avoid rate limit issues.
   * Also (re-)creates PART_OF relations to project entities — needed for issues
   * that were enriched before their project entity existed in the KB.
   */
  async enrichAllTaskEntities(userId: string): Promise<{ enriched: number }> {
    const issues = await this.prisma.jiraIssue.findMany({ where: { userId, active: true } })
    let enriched = 0
    const processedKeys = new Set<string>()

    for (const issue of issues) {
      await this.enrichTaskEntity(userId, issue.issueKey)
      if (issue.projectId) {
        await this.syncProjectRelation(userId, issue.issueKey, issue.projectId)
      }
      processedKeys.add(issue.issueKey.toUpperCase())
      enriched++
    }

    // Also enrich KB task entities that have a jiraIssueKey fact but no jiraIssue DB record
    const kgTasks = await this.prisma.knowledgeEntity.findMany({
      where: { userId, type: 'task' },
      include: { facts: { where: { key: { in: ['jiraIssueKey', 'issueKey'] } } } },
    })
    for (const kgTask of kgTasks) {
      const keyFact = kgTask.facts[0]
      if (!keyFact) continue
      const issueKey = String(keyFact.value)
      if (processedKeys.has(issueKey.toUpperCase())) continue
      await this.enrichTaskEntity(userId, issueKey, kgTask.id)
      processedKeys.add(issueKey.toUpperCase())
      enriched++
    }

    this.logger.log(`Bulk KG enrichment done: ${enriched} issues userId=${userId}`)
    return { enriched }
  }

  private async syncProjectRelation(userId: string, issueKey: string, projectId: string): Promise<void> {
    try {
      const taskEntity = await this.knowledge.findByExternalLink('jira', 'issue', issueKey)
      const projectEntity = await this.knowledge.findByExternalLink('internal', 'project', projectId)
      if (!taskEntity || !projectEntity) return
      await this.knowledge.createRelation(userId, {
        fromEntityId: taskEntity.id,
        toEntityId: projectEntity.id,
        relationType: 'PART_OF',
      }).catch(() => {})
    } catch (err) {
      this.logger.warn(`Project link failed ${issueKey}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async remove(issueId: string, userId: string) {
    const issue = await this.prisma.jiraIssue.findUnique({ where: { id: issueId } })
    if (!issue) throw new NotFoundException(`Issue ${issueId} not found`)
    if (issue.userId !== userId) throw new ForbiddenException('Access denied')
    await this.prisma.jiraIssue.delete({ where: { id: issueId } })
    this.logger.log(`Issue deleted id=${issueId} userId=${userId}`)
  }

  /** Extract "PROJ" from "PROJ-123" and find matching active Project. */
  private async resolveProjectId(userId: string, issueKey: string): Promise<string | null> {
    const prefix = issueKey.split('-')[0]
    if (!prefix) return null
    const project = await this.projects.findByJiraKey(userId, prefix)
    return project?.id ?? null
  }
}
