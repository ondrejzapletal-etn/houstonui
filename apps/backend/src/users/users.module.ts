import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TimeSavedService } from './time-saved.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, TimeSavedService],
  exports: [UsersService, TimeSavedService],
})
export class UsersModule {}
