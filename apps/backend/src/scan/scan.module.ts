import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module'
import { UsersModule } from '../users/users.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ScanFetcherService } from './scan-fetcher.service'
import { ScanClassifierService } from './scan-classifier.service'
import { ScanService } from './scan.service'
import { ScanController } from './scan.controller'
import { ContextController } from './context.controller'

@Module({
  imports: [PrismaModule, AuditModule, ConnectorsModule, AiGatewayModule, UsersModule, KnowledgeModule],
  controllers: [ScanController, ContextController],
  providers: [ScanFetcherService, ScanClassifierService, ScanService],
  exports: [ScanService],
})
export class ScanModule {}
