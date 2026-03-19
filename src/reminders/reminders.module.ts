import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemindersService } from './reminders.service.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { User } from '../entities/user.entity.js';

@Module({
  imports: [TelegramModule, TypeOrmModule.forFeature([User])],
  providers: [RemindersService],
})
export class RemindersModule { }
