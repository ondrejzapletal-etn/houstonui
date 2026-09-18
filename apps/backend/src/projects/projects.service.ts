/**
 * ProjectsService
 *
 * Manages user-owned Project records.
 * Each Project ties a Jira project key to an optional Client and metadata.
 * All access is scoped by userId.
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto'

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      include: { client: { select: { id: true, name: true, domain: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    })
  }

  async create(userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        userId,
        clientId: dto.clientId ?? null,
        name: dto.name,
        jiraProjectKey: dto.jiraProjectKey ?? null,
        pmEmail: dto.pmEmail ?? null,
        notes: dto.notes ?? null,
      },
    })
    this.logger.log(`Project created id=${project.id} key=${project.jiraProjectKey} userId=${userId}`)
    void this.syncProjectEntity(userId, project.id, project.name, project.jiraProjectKey, project.clientId)
    return project
  }

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    await this.getOwned(projectId, userId)
    const updated = await this.prisma.project.update({ where: { id: projectId }, data: dto })
    void this.syncProjectEntity(userId, projectId, updated.name, updated.jiraProjectKey, updated.clientId)
    return updated
  }

  async remove(projectId: string, userId: string) {
    await this.getOwned(projectId, userId)
    await this.prisma.project.delete({ where: { id: projectId } })
    this.logger.log(`Project deleted id=${projectId} userId=${userId}`)
  }

  /**
   * Resolve a Project by its Jira project key prefix.
   * Used internally to auto-link issues to projects (e.g. "PROJ-123" → project with key "PROJ").
   */
  async findByJiraKey(userId: string, jiraProjectKey: string) {
    return this.prisma.project.findFirst({
      where: { userId, jiraProjectKey, active: true },
    })
  }

  /**
   * Najde projekt podle Jira klíče, případně založí nový s tímto klíčem a názvem = klíč.
   * Vrací { project, wasCreated }.
   */
  async findOrCreateProjectByJiraKey(userId: string, jiraProjectKey: string): Promise<{ project: any, wasCreated: boolean }> {
    let project = await this.prisma.project.findFirst({
      where: { userId, jiraProjectKey, active: true },
    })
    if (project) {
      return { project, wasCreated: false }
    }
    project = await this.prisma.project.create({
      data: {
        userId,
        name: jiraProjectKey,
        jiraProjectKey,
        active: true,
      },
    })
    this.logger.log(`Project auto-created key=${jiraProjectKey} userId=${userId}`)
    void this.syncProjectEntity(userId, project.id, project.name, project.jiraProjectKey, null)
    return { project, wasCreated: true }
  }

  private async syncProjectEntity(
    userId: string,
    projectId: string,
    name: string,
    jiraProjectKey: string | null,
    clientId: string | null,
  ): Promise<void> {
    try {
      const entity = await this.knowledge.resolveEntity(userId, 'internal', 'project', projectId, {
        type: 'project',
        title: name,
      })
      if (jiraProjectKey) {
        await this.knowledge.upsertFactInternal(entity.id, 'jiraProjectKey', jiraProjectKey, 'internal')
      }
      if (clientId) {
        const clientEntity = await this.knowledge.findByExternalLink('internal', 'client', clientId)
        if (clientEntity) {
          await this.knowledge.createRelation(userId, {
            fromEntityId: entity.id,
            toEntityId: clientEntity.id,
            relationType: 'PART_OF',
          })
        }
      }
    } catch (err) {
      this.logger.warn(`KG project sync: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async getOwned(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException(`Project ${projectId} not found`)
    if (project.userId !== userId) throw new ForbiddenException('Access denied')
    return project
  }
}
