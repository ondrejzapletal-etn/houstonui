import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeIngestionService } from './knowledge-ingestion.service'
import {
  CreateEntityDto,
  CreateObservationDto,
  CreateRelationDto,
  UpdateEntityDto,
  UpsertFactDto,
} from './types'

@Controller('knowledge')
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name)

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private uid(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /** GET /api/v1/knowledge/tasks */
  @Get('tasks')
  async listTasksForDashboard(@CurrentUser() user: CurrentUserData) {
    const tasks = await this.knowledge.listTasksForDashboard(this.uid(user, 'listTasksForDashboard'))
    return { success: true, data: { tasks } }
  }

  /** GET /api/v1/knowledge/entities */
  @Get('entities')
  async listEntities(
    @CurrentUser() user: CurrentUserData,
    @Query('type') type?: string,
  ) {
    const entities = await this.knowledge.listEntities(this.uid(user, 'listEntities'), type)
    return { success: true, data: { entities } }
  }

  /** GET /api/v1/knowledge/search */
  @Get('search')
  async search(
    @CurrentUser() user: CurrentUserData,
    @Query('q') q: string,
    @Query('type') type?: string,
  ) {
    const entities = await this.knowledge.searchEntities(this.uid(user, 'search'), q ?? '', type)
    return { success: true, data: { entities } }
  }

  /** GET /api/v1/knowledge/entities/:id */
  @Get('entities/:id')
  async getEntity(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const entity = await this.knowledge.getEntity(id, this.uid(user, 'getEntity'))
    return { success: true, data: { entity } }
  }

  /** GET /api/v1/knowledge/entities/:id/graph */
  @Get('entities/:id/graph')
  async getEntityGraph(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const graph = await this.knowledge.getEntityGraph(id, this.uid(user, 'getEntityGraph'))
    return { success: true, data: graph }
  }

  /** POST /api/v1/knowledge/entities */
  @Post('entities')
  @HttpCode(HttpStatus.CREATED)
  async createEntity(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateEntityDto,
  ) {
    const entity = await this.knowledge.createEntity(this.uid(user, 'createEntity'), dto)
    return { success: true, data: { entity } }
  }

  /** PUT /api/v1/knowledge/entities/:id */
  @Put('entities/:id')
  async updateEntity(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateEntityDto,
  ) {
    const entity = await this.knowledge.updateEntity(id, this.uid(user, 'updateEntity'), dto)
    return { success: true, data: { entity } }
  }

  /** DELETE /api/v1/knowledge/entities/:id */
  @Delete('entities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEntity(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.knowledge.deleteEntity(id, this.uid(user, 'deleteEntity'))
  }

  /** POST /api/v1/knowledge/relations */
  @Post('relations')
  @HttpCode(HttpStatus.CREATED)
  async createRelation(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRelationDto,
  ) {
    const relation = await this.knowledge.createRelation(this.uid(user, 'createRelation'), dto)
    return { success: true, data: { relation } }
  }

  /** POST /api/v1/knowledge/observations */
  @Post('observations')
  @HttpCode(HttpStatus.CREATED)
  async addObservation(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateObservationDto,
  ) {
    const observation = await this.knowledge.addObservation(this.uid(user, 'addObservation'), dto)
    return { success: true, data: { observation } }
  }

  /** GET /api/v1/knowledge/observations */
  @Get('observations')
  async listObservations(
    @CurrentUser() user: CurrentUserData,
    @Query('entityId') entityId?: string,
  ) {
    const observations = await this.knowledge.listObservations(this.uid(user, 'listObservations'), entityId)
    return { success: true, data: { observations } }
  }

  /** PUT /api/v1/knowledge/entities/:id/facts */
  @Put('entities/:id/facts')
  async upsertFact(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpsertFactDto,
  ) {
    const fact = await this.knowledge.upsertFact(id, this.uid(user, 'upsertFact'), dto)
    return { success: true, data: { fact } }
  }

  /** GET /api/v1/knowledge/events */
  @Get('events')
  async listEvents(
    @CurrentUser() user: CurrentUserData,
    @Query('entityId') entityId?: string,
  ) {
    const events = await this.knowledge.listEvents(this.uid(user, 'listEvents'), entityId)
    return { success: true, data: { events } }
  }

  /** POST /api/v1/knowledge/sync — retroactively sync existing clients/projects/issues */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncExisting(@CurrentUser() user: CurrentUserData) {
    const result = await this.ingestion.syncExistingDomainData(this.uid(user, 'sync'))
    return { success: true, data: result }
  }
}
