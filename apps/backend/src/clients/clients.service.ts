/**
 * ClientsService
 *
 * Manages user-owned Client records (business entities / customers).
 * All access is scoped by userId – users can only see their own clients.
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { CreateClientDto, UpdateClientDto } from './dto/client.dto'

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async list(userId: string) {
    return this.prisma.client.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })
  }

  async create(userId: string, dto: CreateClientDto) {
    const client = await this.prisma.client.create({
      data: { userId, ...dto },
    })
    this.logger.log(`Client created id=${client.id} userId=${userId}`)
    void this.knowledge.resolveEntity(userId, 'internal', 'client', client.id, {
      type: 'organization',
      title: client.name,
      description: client.notes ?? undefined,
    }).then((e) => client.domain
      ? this.knowledge.upsertFactInternal(e.id, 'domain', client.domain, 'internal')
      : Promise.resolve(),
    ).catch((err) => this.logger.warn(`KG client create: ${err instanceof Error ? err.message : String(err)}`))
    return client
  }

  async update(clientId: string, userId: string, dto: UpdateClientDto) {
    await this.getOwned(clientId, userId)
    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: dto,
    })
    void this.knowledge.resolveEntity(userId, 'internal', 'client', clientId, {
      type: 'organization',
      title: updated.name,
      description: updated.notes ?? undefined,
    }).then((e) =>
      Promise.all([
        updated.domain ? this.knowledge.upsertFactInternal(e.id, 'domain', updated.domain, 'internal') : Promise.resolve(),
        dto.name ? this.knowledge.updateEntity(e.id, userId, { title: dto.name }) : Promise.resolve(),
      ]),
    ).catch((err) => this.logger.warn(`KG client update: ${err instanceof Error ? err.message : String(err)}`))
    return updated
  }

  async remove(clientId: string, userId: string) {
    await this.getOwned(clientId, userId)
    await this.prisma.client.delete({ where: { id: clientId } })
    this.logger.log(`Client deleted id=${clientId} userId=${userId}`)
  }

  async getOwned(clientId: string, userId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } })
    if (!client) throw new NotFoundException(`Client ${clientId} not found`)
    if (client.userId !== userId) throw new ForbiddenException('Access denied')
    return client
  }
}
