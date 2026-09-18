import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { IssuesModule } from '../issues/issues.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ClientsModule } from '../clients/clients.module'
import { UsersModule } from '../users/users.module'
import { ProposalsService } from './proposals.service'
import { ProposalsController } from './proposals.controller'

@Module({
  imports: [PrismaModule, AuditModule, IssuesModule, ConnectorsModule, AiGatewayModule, KnowledgeModule, ClientsModule, UsersModule],
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
