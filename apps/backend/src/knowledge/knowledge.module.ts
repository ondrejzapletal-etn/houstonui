import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeController } from './knowledge.controller'
import { KnowledgeIngestionService } from './knowledge-ingestion.service'

@Module({
  imports: [PrismaModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeIngestionService],
  exports: [KnowledgeService, KnowledgeIngestionService],
})
export class KnowledgeModule {}
