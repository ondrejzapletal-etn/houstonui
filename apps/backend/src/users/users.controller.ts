
import { Controller, Get, Post, Logger, Query, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { TimeSavedService } from './time-saved.service';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { ReportRangeQueryDto } from '../reporting/report-range-query.dto';

@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);
  constructor(
    private readonly usersService: UsersService,
    private readonly timeSaved: TimeSavedService,
  ) {}

  // DEV fallback na dev-user-placeholder pokud není user.id
  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private resolveUserId(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id;
    this.logger.error(`${op}: reached without an authenticated user – refusing`);
    throw new UnauthorizedException();
  }

  @Get('me/stats')
  async getMyStats(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user, 'getMyStats');
    return this.usersService.getUserStats(userId);
  }

  @Get('me/time-saved')
  async getMyTimeSaved(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user, 'getMyTimeSaved');
    return this.timeSaved.getSummary(userId);
  }

  @Get('me/time-saved/range')
  async getMyTimeSavedReport(
    @CurrentUser() user: CurrentUserData,
    @Query() range: ReportRangeQueryDto,
  ) {
    const userId = this.resolveUserId(user, 'getMyTimeSavedReport');
    return this.timeSaved.getReport(userId, range);
  }

  @Post('me/increment-processed-messages')
  async incrementProcessedMessages(@CurrentUser() user: CurrentUserData) {
    const userId = this.resolveUserId(user, 'incrementProcessedMessages');
    this.logger.log(`incrementProcessedMessages called for userId=${userId}`);
    const result = await this.usersService.incrementProcessedMessages(userId);
    void this.timeSaved.record(userId, 'processed_message');
    return result;
  }
}
