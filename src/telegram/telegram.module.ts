import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service.js';
import { TelegramController } from './telegram.controller.js';
import { User } from '../entities/user.entity.js';
import { CommitmentLog } from '../entities/commitment-log.entity.js';
import { SessionsModule } from '../sessions/sessions.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, CommitmentLog]), SessionsModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule { }
