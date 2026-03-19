import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { CommitmentLog } from '../entities/commitment-log.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
  ) { }

  async getUserProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        sessions: {
          session: {
            commitments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.logs = await this.logRepository.find({
      where: { userId },
      order: { date: 'DESC' },
      take: 50,
    });

    return user;
  }
}
