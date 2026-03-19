import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { User } from '../entities/user.entity.js';
import { CommitmentLog } from '../entities/commitment-log.entity.js';
import { Session } from '../entities/session.entity.js';
import { Commitment } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, CommitmentLog, Session, Commitment, SessionParticipant]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
