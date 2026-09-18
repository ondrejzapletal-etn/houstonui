import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { CalendarLinksService } from './calendar-links.service'
import { UpsertCalendarIssueLinkDto } from './dto/calendar-link.dto'

@Controller('calendar-links')
export class CalendarLinksController {
  private readonly logger = new Logger(CalendarLinksController.name)

  constructor(private readonly calendarLinks: CalendarLinksService) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private uid(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /**
   * GET /api/v1/calendar-links
   * Returns all saved issue links for the authenticated user.
   */
  @Get()
  async listAll(@CurrentUser() user: CurrentUserData) {
    const links = await this.calendarLinks.listAll(this.uid(user, 'listAll'))
    return { success: true, data: { links } }
  }

  /**
   * GET /api/v1/calendar-links/suggest-issue?email=a@b.com&email=c@d.com
   * Suggests Jira issues based on email domains matched to known clients.
   * Used when no saved calendar binding exists (first occurrence / new event).
   */
  @Get('suggest-issue')
  async suggestIssue(
    @CurrentUser() user: CurrentUserData,
    @Query('email') emailParam: string | string[] | undefined,
  ) {
    const emails = emailParam ? (Array.isArray(emailParam) ? emailParam : [emailParam]) : []
    const result = await this.calendarLinks.suggestIssues(this.uid(user, 'suggestIssue'), emails)
    return { success: true, data: result }
  }

  /**
   * GET /api/v1/calendar-links/:calendarEventId
   * Returns the saved issue link for a calendar event (404 if none).
   */
  @Get(':calendarEventId')
  async find(
    @CurrentUser() user: CurrentUserData,
    @Param('calendarEventId') calendarEventId: string,
    @Query('recurringEventId') recurringEventId?: string,
  ) {
    try {
      const link = await this.calendarLinks.find(this.uid(user, 'find'), calendarEventId, recurringEventId)
      return { success: true, data: { link } }
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { success: true, data: { link: null } }
      }
      throw err
    }
  }

  /**
   * PUT /api/v1/calendar-links/:calendarEventId
   * Upsert the issue link for a calendar event (called after successful worklog submit).
   */
  @Put(':calendarEventId')
  @HttpCode(HttpStatus.OK)
  async upsert(
    @CurrentUser() user: CurrentUserData,
    @Param('calendarEventId') calendarEventId: string,
    @Body() dto: UpsertCalendarIssueLinkDto,
  ) {
    const link = await this.calendarLinks.upsert(this.uid(user, 'upsert'), calendarEventId, dto)
    return { success: true, data: { link } }
  }

  /**
   * DELETE /api/v1/calendar-links/:calendarEventId
   * Remove the issue link for a calendar event.
   */
  @Delete(':calendarEventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('calendarEventId') calendarEventId: string,
  ) {
    await this.calendarLinks.remove(this.uid(user, 'remove'), calendarEventId)
  }
}
