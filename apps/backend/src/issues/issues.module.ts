import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { IssuesService } from './issues.service'
import { IssuesController } from './issues.controller'

@Module({
  imports: [PrismaModule, ProjectsModule, KnowledgeModule, ConnectorsModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
