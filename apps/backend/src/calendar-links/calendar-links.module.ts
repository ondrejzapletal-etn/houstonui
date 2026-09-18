import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { IssuesModule } from '../issues/issues.module'
import { CalendarLinksService } from './calendar-links.service'
import { CalendarLinksController } from './calendar-links.controller'

@Module({
  imports: [PrismaModule, IssuesModule],
  controllers: [CalendarLinksController],
  providers: [CalendarLinksService],
  exports: [CalendarLinksService],
})
export class CalendarLinksModule {}
