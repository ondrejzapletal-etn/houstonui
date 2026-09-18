import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { UsersModule } from '../users/users.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { KeyVaultService } from './key-vault.service'
import { ConnectorCredentialsService } from './connector-credentials.service'
import { ConnectorCredentialsController } from './connector-credentials.controller'
import { ConnectorsService } from './connectors.service'
import { ConnectorsController } from './connectors.controller'
import { GmailService } from './gmail/gmail.service'
import { GmailController } from './gmail/gmail.controller'
import { SlackService } from './slack/slack.service'
import { SlackController } from './slack/slack.controller'
import { JiraService } from './jira/jira.service'
import { ClockifyService } from './clockify/clockify.service'
import { HotSpotService } from './hotspot/hotspot.service'
import { CalendarService } from './calendar/calendar.service'
import { UnreadCountService } from './unread-count.service'
import { GmailScanSuggestionsService } from './gmail/gmail-scan-suggestions.service'

@Module({
  imports: [PrismaModule, AuditModule, UsersModule, KnowledgeModule],
  controllers: [ConnectorsController, ConnectorCredentialsController, GmailController, SlackController],
  providers: [
    KeyVaultService,
    ConnectorCredentialsService,
    ConnectorsService,
    GmailService,
    SlackService,
    JiraService,
    ClockifyService,
    HotSpotService,
    CalendarService,
    UnreadCountService,
    GmailScanSuggestionsService,
  ],
  exports: [ConnectorCredentialsService, ConnectorsService, UnreadCountService, JiraService, ClockifyService, HotSpotService, CalendarService, GmailService, SlackService],
})
export class ConnectorsModule {}
