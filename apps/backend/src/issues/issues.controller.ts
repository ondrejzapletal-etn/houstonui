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
  Query,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { IssuesService } from './issues.service'
import { UpsertJiraIssueDto, IssueSearchQuery } from './dto/issue.dto'

@Controller('issues')
export class IssuesController {
  private readonly logger = new Logger(IssuesController.name)

  constructor(private readonly issues: IssuesService) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private uid(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /**
   * GET /api/v1/issues[?search=&projectId=]
   * Returns cached Jira issues for autocomplete.
   */
  @Get()
  async search(@CurrentUser() user: CurrentUserData, @Query() query: IssueSearchQuery) {
    const items = await this.issues.search(this.uid(user, 'search'), query)
    return { success: true, data: { issues: items } }
  }

  /**
   * POST /api/v1/issues
   * Upsert a Jira issue into the local cache.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async upsert(@CurrentUser() user: CurrentUserData, @Body() dto: UpsertJiraIssueDto) {
    const issue = await this.issues.upsertFromKey(this.uid(user, 'upsert'), dto)
    return { success: true, data: { issue } }
  }

  /**
   * DELETE /api/v1/issues/:id
   * Remove an issue from the local cache.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.issues.remove(id, this.uid(user, 'remove'))
  }

  /**
   * POST /api/v1/issues/enrich-kg
   * Bulk-enrich all cached Jira issues with full details from Jira API.
   */
  @Post('enrich-kg')
  @HttpCode(HttpStatus.OK)
  async enrichKg(@CurrentUser() user: CurrentUserData) {
    const result = await this.issues.enrichAllTaskEntities(this.uid(user, 'enrichKg'))
    return { success: true, data: result }
  }
}
