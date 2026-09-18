import { Body, Controller, Get, Logger, Put, Query, UnauthorizedException } from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { SettingsService } from './settings.service'
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto'
import { ReportRangeQueryDto } from '../reporting/report-range-query.dto'

/**
 * Server-side user settings. API keys are never returned – only which providers
 * have one configured.
 */
@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name)

  constructor(private readonly settings: SettingsService) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private resolveUserId(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /** GET /api/v1/settings/ai */
  @Get('ai')
  async getAiSettings(@CurrentUser() user: CurrentUserData) {
    return this.settings.getAiSettings(this.resolveUserId(user, 'getAiSettings'))
  }

  /** PUT /api/v1/settings/ai */
  @Put('ai')
  async updateAiSettings(
    @CurrentUser() user: CurrentUserData,
    @Body() body: UpdateAiSettingsDto,
  ) {
    const userId = this.resolveUserId(user, 'updateAiSettings')
    return this.settings.updateAiSettings(userId, body.aiProvider)
  }

  /** GET /api/v1/settings/ai/usage */
  @Get('ai/usage')
  async getAiUsage(@CurrentUser() user: CurrentUserData) {
    return this.settings.getAiUsage(this.resolveUserId(user, 'getAiUsage'))
  }

  /** GET /api/v1/settings/ai/usage/range?from&to&granularity */
  @Get('ai/usage/range')
  async getAiUsageReport(
    @CurrentUser() user: CurrentUserData,
    @Query() range: ReportRangeQueryDto,
  ) {
    return this.settings.getAiUsageReport(this.resolveUserId(user, 'getAiUsageReport'), range)
  }
}
