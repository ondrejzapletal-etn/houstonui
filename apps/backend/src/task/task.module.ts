import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { TaskIntentAnalyzerService } from './task-intent-analyzer.service'
import { TaskContextBuilderService } from './task-context-builder.service'
import { TaskResponseGeneratorService } from './task-response-generator.service'
import { TaskOrchestratorService } from './task-orchestrator.service'
import { TaskController } from './task.controller'

@Module({
  imports: [PrismaModule, AuditModule, AiGatewayModule, KnowledgeModule, ConnectorsModule],
  controllers: [TaskController],
  providers: [
    TaskIntentAnalyzerService,
    TaskContextBuilderService,
    TaskResponseGeneratorService,
    TaskOrchestratorService,
  ],
})
export class TaskModule {}
