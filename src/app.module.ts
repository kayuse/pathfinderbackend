import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { AdminModule } from './admin/admin.module.js';
import { User } from './entities/user.entity.js';
import { Session } from './entities/session.entity.js';
import { Commitment } from './entities/commitment.entity.js';
import { SessionParticipant } from './entities/session-participant.entity.js';
import { CommitmentLog } from './entities/commitment-log.entity.js';
import { ConfigModule } from '@nestjs/config/dist/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,        // makes process.env available everywhere
      envFilePath: '.env',   // optional if .env is in project root
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Session, Commitment, SessionParticipant, CommitmentLog],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: false,
    }),
    AuthModule,
    UsersModule,
    TelegramModule,
    SessionsModule,
    RemindersModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
