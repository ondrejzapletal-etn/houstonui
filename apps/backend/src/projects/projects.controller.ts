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
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ProjectsService } from './projects.service'
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto'

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name)

  constructor(private readonly projects: ProjectsService) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private uid(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /**
   * POST /api/v1/projects/find-or-create
   * Najde nebo vytvoří projekt podle Jira klíče (identu).
   * Body: { jiraProjectKey: string }
   */
  @Post('find-or-create')
  @HttpCode(HttpStatus.OK)
  async findOrCreate(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { jiraProjectKey: string },
  ) {
    const { jiraProjectKey } = body;
    if (!jiraProjectKey || typeof jiraProjectKey !== 'string') {
      return { success: false, error: 'jiraProjectKey is required' }
    }
    const { project, wasCreated } = await this.projects.findOrCreateProjectByJiraKey(this.uid(user, 'findOrCreate'), jiraProjectKey)
    return { success: true, wasCreated, data: { project } }
  }

  /** GET /api/v1/projects */
  @Get()
  async list(@CurrentUser() user: CurrentUserData) {
    const items = await this.projects.list(this.uid(user, 'list'))
    return { success: true, data: { projects: items } }
  }

  /** POST /api/v1/projects */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateProjectDto) {
    const project = await this.projects.create(this.uid(user, 'create'), dto)
    return { success: true, data: { project } }
  }

  /** PUT /api/v1/projects/:id */
  @Put(':id')
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projects.update(id, this.uid(user, 'update'), dto)
    return { success: true, data: { project } }
  }

  /** DELETE /api/v1/projects/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.projects.remove(id, this.uid(user, 'remove'))
  }
}
