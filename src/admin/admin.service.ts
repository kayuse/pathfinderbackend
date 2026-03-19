import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, IsNull, Not } from 'typeorm';
import { User, Role } from '../entities/user.entity.js';
import { CommitmentLog, LogStatus } from '../entities/commitment-log.entity.js';
import { Session } from '../entities/session.entity.js';
import { Commitment, Frequency } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(Commitment)
    private commitmentRepository: Repository<Commitment>,
    @InjectRepository(SessionParticipant)
    private participantRepository: Repository<SessionParticipant>,
  ) {}

  /**
   * List all users with optional filtering and pagination
   */
  async listUsers(query: {
    search?: string;
    role?: string;
    sessionId?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, role, sessionId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    let qb = this.userRepository.createQueryBuilder('user');

    if (search) {
      qb = qb.andWhere(
        '(user.email ILIKE :search OR user.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (role) {
      qb = qb.andWhere('user.role = :role', { role });
    }

    if (sessionId) {
      qb = qb
        .leftJoin(SessionParticipant, 'sp', 'sp.userId = user.id')
        .andWhere('sp.sessionId = :sessionId', { sessionId });
    }

    const [users, total] = await qb
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        telegramId: u.telegramId,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Create a new user via admin
   */
  async createUser(createUserDto: CreateUserDto) {
    const { email, password, name, role } = createUserDto;

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new Error('Email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = this.userRepository.create({
      email,
      passwordHash,
      name: name || email.split('@')[0],
      role: (role as Role) || Role.USER,
    });

    await this.userRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  /**
   * Get users who logged tasks in a session during a date range
   */
  async getLoggedUsers(sessionId: string, startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    // Get all commitments in the session
    const commitments = await this.commitmentRepository.find({
      where: { sessionId },
    });

    const commitmentIds = commitments.map(c => c.id);

    // Get users who logged any commitment in date range
    const logs = await this.logRepository.find({
      where: {
        commitmentId: commitmentIds as any,
        date: Between(start, end),
        status: Not(LogStatus.PENDING),
      },
    });

    const userIds = new Set(logs.map(l => l.userId));
    const users = await this.userRepository.findByIds(Array.from(userIds));

    return users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      logCount: logs.filter(l => l.userId === u.id).length,
      lastLogDate: new Date(Math.max(...logs.filter(l => l.userId === u.id).map(l => new Date(l.date).getTime()))),
    }));
  }

  /**
   * Get users who have NOT logged tasks in a session (follow-up list)
   */
  async getNotLoggedUsers(sessionId: string, startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    // Get all participants in the session
    const participants = await this.participantRepository.find({
      where: { sessionId },
      relations: ['user'],
    });

    // Get users who logged anything in date range for this session
    const commitments = await this.commitmentRepository.find({
      where: { sessionId },
    });

    const commitmentIds = commitments.map(c => c.id);

    const logs = await this.logRepository.find({
      where: {
        commitmentId: commitmentIds as any,
        date: Between(start, end),
        status: Not(LogStatus.PENDING),
      },
    });

    const loggedUserIds = new Set(logs.map(l => l.userId));

    // Return participants who haven't logged
    return participants
      .filter(p => !loggedUserIds.has(p.userId))
      .map(p => ({
        id: p.user.id,
        email: p.user.email,
        name: p.user.name,
        joinedAt: p.joinedAt,
      }));
  }

  /**
   * Get completion rates by session
   */
  async getCompletionBySession(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    const sessions = await this.sessionRepository.find({
      relations: ['commitments'],
    });

    const results = await Promise.all(
      sessions.map(async session => {
        const commitmentIds = session.commitments.map(c => c.id);

        if (!commitmentIds.length) {
          return { sessionId: session.id, sessionName: session.name, completionRate: 0, totalLogs: 0, completedLogs: 0 };
        }

        const [total, completed] = await Promise.all([
          this.logRepository.count({
            where: {
              commitmentId: commitmentIds as any,
              date: Between(start, end),
            },
          }),
          this.logRepository.count({
            where: {
              commitmentId: commitmentIds as any,
              date: Between(start, end),
              status: LogStatus.COMPLETED,
            },
          }),
        ]);

        return {
          sessionId: session.id,
          sessionName: session.name,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
          totalLogs: total,
          completedLogs: completed,
        };
      }),
    );

    return results.filter(r => r.totalLogs > 0);
  }

  /**
   * Get completion rates by frequency
   */
  async getCompletionByFrequency(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    const frequencies = [Frequency.DAILY, Frequency.WEEKLY, Frequency.MONTHLY, Frequency.CUSTOM];

    const results = await Promise.all(
      frequencies.map(async frequency => {
        const commitments = await this.commitmentRepository.find({
          where: { frequency: frequency as Frequency },
        });

        const commitmentIds = commitments.map(c => c.id);

        if (!commitmentIds.length) {
          return { frequency, completionRate: 0, totalLogs: 0, completedLogs: 0 };
        }

        const [total, completed] = await Promise.all([
          this.logRepository.count({
            where: {
              commitmentId: commitmentIds as any,
              date: Between(start, end),
            },
          }),
          this.logRepository.count({
            where: {
              commitmentId: commitmentIds as any,
              date: Between(start, end),
              status: LogStatus.COMPLETED,
            },
          }),
        ]);

        return {
          frequency,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
          totalLogs: total,
          completedLogs: completed,
        };
      }),
    );

    return results.filter(r => r.totalLogs > 0);
  }

  /**
   * Export analytics as CSV
   */
  async exportAnalyticsCSV(sessionId?: string, startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    // Get logged users
    let loggedUsers = [];
    if (sessionId) {
      loggedUsers = await this.getLoggedUsers(sessionId, startDate, endDate);
    } else {
      // Get all users who logged anything
      const logs = await this.logRepository.find({
        where: {
          date: Between(start, end),
          status: Not(LogStatus.PENDING),
        },
      });

      const userIds = new Set(logs.map(l => l.userId));
      const users = await this.userRepository.findByIds(Array.from(userIds));

      loggedUsers = users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        logCount: logs.filter(l => l.userId === u.id).length,
      }));
    }

    // Generate CSV
    const headers = ['User ID', 'Email', 'Name', 'Log Count'];
    const rows = loggedUsers.map(u => [u.id, u.email, u.name, u.logCount]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    return csv;
  }
}
