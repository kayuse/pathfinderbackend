import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { User } from '../entities/user.entity.js';
import { CommitmentLog } from '../entities/commitment-log.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, CommitmentLog])],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule { }
