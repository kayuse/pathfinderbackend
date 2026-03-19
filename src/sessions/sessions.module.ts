import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsService } from './sessions.service.js';
import { SessionsController } from './sessions.controller.js';
import { Session } from '../entities/session.entity.js';
import { Commitment } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';
import { CommitmentLog } from '../entities/commitment-log.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Commitment, SessionParticipant, CommitmentLog])],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule { }
