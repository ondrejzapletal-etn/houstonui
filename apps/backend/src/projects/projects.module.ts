import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ProjectsService } from './projects.service'
import { ProjectsController } from './projects.controller'

@Module({
  imports: [PrismaModule, KnowledgeModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
