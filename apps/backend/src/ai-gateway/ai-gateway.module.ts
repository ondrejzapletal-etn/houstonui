import { Module } from '@nestjs/common'
import { AiGatewayService } from './ai-gateway.service'
import { AiProviderResolver } from './ai-provider-resolver.service'
import { AiUsageLoggerService } from './ai-usage-logger.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [AiGatewayService, AiProviderResolver, AiUsageLoggerService],
  exports: [AiGatewayService, AiProviderResolver, AiUsageLoggerService],
})
export class AiGatewayModule {}
