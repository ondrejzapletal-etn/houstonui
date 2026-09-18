import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { ClientsService } from './clients.service'
import { ClientsController } from './clients.controller'

@Module({
  imports: [PrismaModule, KnowledgeModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
