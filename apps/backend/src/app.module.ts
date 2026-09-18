import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { ConnectorsModule } from './connectors/connectors.module'
import { AiGatewayModule } from './ai-gateway/ai-gateway.module'
import { ProposalsModule } from './proposals/proposals.module'
import { ScanModule } from './scan/scan.module'
import { ClientsModule } from './clients/clients.module'
import { ProjectsModule } from './projects/projects.module'
import { IssuesModule } from './issues/issues.module'
import { CalendarLinksModule } from './calendar-links/calendar-links.module'
import { validate } from './config/env.validation'
import { UsersModule } from './users/users.module'
import { KnowledgeModule } from './knowledge/knowledge.module'
import { TaskModule } from './task/task.module'
import { SettingsModule } from './settings/settings.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    HealthModule,
    PrismaModule,
    AuthModule,
    ConnectorsModule,
    AiGatewayModule,
    ProposalsModule,
    ScanModule,
    TaskModule,
    ClientsModule,
    ProjectsModule,
    IssuesModule,
    CalendarLinksModule,
    UsersModule,
    KnowledgeModule,
    SettingsModule,
  ],
})
export class AppModule {}
