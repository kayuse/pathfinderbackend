import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Session } from '../entities/session.entity.js';
import { Commitment, Frequency } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';
import { CommitmentLog, LogStatus } from '../entities/commitment-log.entity.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { CreateCommitmentDto } from './dto/create-commitment.dto.js';

type SessionStatus = 'RUNNING' | 'OPEN_FOR_APPLICATION' | 'UPCOMING' | 'COMPLETED';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(Commitment)
    private commitmentRepository: Repository<Commitment>,
    @InjectRepository(SessionParticipant)
    private participantRepository: Repository<SessionParticipant>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
  ) { }

  async createSession(data: CreateSessionDto) {
    const session = this.sessionRepository.create({
      id: randomUUID(),
      ...data,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    });
    return this.sessionRepository.save(session);
  }

  async findAll() {
    return this.sessionRepository.find({
      relations: ['commitments'],
      order: { startDate: 'ASC' },
    });
  }

  private getSessionStatus(session: Session): SessionStatus {
    const now = new Date();
    const start = new Date(session.startDate);
    const end = new Date(session.endDate);

    if (now >= start && now <= end) {
      return 'RUNNING';
    }

    if (session.openForApplication && now < start) {
      return 'OPEN_FOR_APPLICATION';
    }

    if (now < start) {
      return 'UPCOMING';
    }

    return 'COMPLETED';
  }

  private getDurationDays(session: Session): number {
    const start = new Date(session.startDate).setHours(0, 0, 0, 0);
    const end = new Date(session.endDate).setHours(0, 0, 0, 0);
    const diff = Math.max(0, end - start);
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
  }

  async findDiscoverableSessions() {
    const sessions = await this.sessionRepository.find({
      relations: ['commitments'],
      order: { startDate: 'ASC' },
    });

    return sessions
      .map((session) => {
        const status = this.getSessionStatus(session);
        return {
          ...session,
          status,
          durationDays: this.getDurationDays(session),
        };
      })
      .filter((session) => session.status === 'RUNNING' || session.status === 'OPEN_FOR_APPLICATION');
  }

  async findOne(id: string) {
    const session = await this.sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.commitments', 'commitments')
      .leftJoinAndSelect('session.participants', 'participants')
      .leftJoin('participants.user', 'user')
      .addSelect(['user.id', 'user.name', 'user.telegramUsername'])
      .where('session.id = :id', { id })
      .getOne();

    if (!session) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }

    return session;
  }

  async remove(id: string) {
    const session = await this.findOne(id);
    return this.sessionRepository.remove(session);
  }

  async joinSession(sessionId: string, userId: string) {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const status = this.getSessionStatus(session);
    if (!(status === 'RUNNING' || status === 'OPEN_FOR_APPLICATION')) {
      throw new ConflictException('This session is not open for enrollment');
    }

    try {
      const participant = this.participantRepository.create({ sessionId, userId });
      const savedParticipant = await this.participantRepository.save(participant);
      const roadmap = await this.getRoadmapSummary(sessionId);

      return {
        participant: savedParticipant,
        onboarding: {
          sessionId: session.id,
          sessionName: session.name,
          spiritualFocus: session.spiritualFocus || session.description || 'Spiritual discipline',
          startDate: session.startDate,
          durationDays: this.getDurationDays(session),
          roadmap,
        },
      };
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException('User is already a participant in this session');
      }
      throw error;
    }
  }

  async createCommitment(sessionId: string, data: CreateCommitmentDto) {
    const commitment = this.commitmentRepository.create({
      id: randomUUID(),
      ...data,
      sessionId,
    });
    return this.commitmentRepository.save(commitment);
  }

  async getRoadmapSummary(sessionId: string) {
    const commitments = await this.commitmentRepository.find({ where: { sessionId } });

    const toRoadmapItem = (commitment: Commitment) => ({
      id: commitment.id,
      title: commitment.title,
      description: commitment.description,
      frequency: commitment.frequency,
      targetValue: commitment.targetValue,
    });

    return {
      daily: commitments.filter((c) => c.frequency === Frequency.DAILY).map(toRoadmapItem),
      weekly: commitments.filter((c) => c.frequency === Frequency.WEEKLY).map(toRoadmapItem),
      monthly: commitments.filter((c) => c.frequency === Frequency.MONTHLY).map(toRoadmapItem),
      custom: commitments.filter((c) => c.frequency === Frequency.CUSTOM).map(toRoadmapItem),
    };
  }

  async getUserTodayTasks(userId: string, targetDateInput?: string) {
    const targetDate = targetDateInput ? new Date(targetDateInput) : new Date();
    const today = new Date(targetDate);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const userSessions = await this.participantRepository.find({
      where: { userId },
      relations: ['session', 'session.commitments'],
      order: { joinedAt: 'DESC' },
    });

    const activeSessions = userSessions
      .map((participant) => participant.session)
      .filter((session) => {
        const start = new Date(session.startDate);
        const end = new Date(session.endDate);
        return today >= start && today <= end;
      });

    const commitmentIds = activeSessions.flatMap((session) => session.commitments.map((c) => c.id));

    if (commitmentIds.length === 0) {
      return {
        date: today.toISOString(),
        sessions: [],
        tasks: [],
        completionRate: 0,
      };
    }

    const logs = await this.logRepository
      .createQueryBuilder('log')
      .where('log.userId = :userId', { userId })
      .andWhere('log.commitmentId IN (:...commitmentIds)', { commitmentIds })
      .andWhere('log.date >= :startOfDay', { startOfDay: today.toISOString() })
      .andWhere('log.date < :endOfDay', { endOfDay: tomorrow.toISOString() })
      .getMany();

    const logByCommitmentId = new Map<string, CommitmentLog>();
    logs.forEach((log) => {
      logByCommitmentId.set(log.commitmentId, log);
    });

    const tasks = activeSessions.flatMap((session) =>
      session.commitments
        .filter((commitment) => commitment.frequency === Frequency.DAILY)
        .map((commitment) => {
          const existingLog = logByCommitmentId.get(commitment.id);
          return {
            id: commitment.id,
            sessionId: session.id,
            sessionName: session.name,
            title: commitment.title,
            description: commitment.description,
            frequency: commitment.frequency,
            status: existingLog?.status ?? LogStatus.PENDING,
            date: today.toISOString(),
          };
        }),
    );

    const completedCount = tasks.filter((task) => task.status === LogStatus.COMPLETED).length;
    const completionRate = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

    return {
      date: today.toISOString(),
      sessions: activeSessions.map((session) => ({
        id: session.id,
        name: session.name,
        spiritualFocus: session.spiritualFocus,
      })),
      tasks,
      completionRate,
    };
  }

  async isEnrolled(userId: string, sessionId: string): Promise<boolean> {
    const participant = await this.participantRepository.findOne({
      where: { userId, sessionId },
    });
    return !!participant;
  }

  async getUserEnrolledSessionIds(userId: string): Promise<string[]> {
    const participants = await this.participantRepository.find({
      where: { userId },
      select: ['sessionId'],
    });
    return participants.map((p) => p.sessionId);
  }

  /**
   * Returns daily, weekly, and monthly tasks with current-period completion status.
   * - Daily  : tasks that match today's date range
   * - Weekly : tasks logged in the current Mon–Sun week
   * - Monthly: tasks logged in the current calendar month
   */
  async getUserAllTasks(userId: string) {
    const now = new Date();

    // --- date range helpers ---
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // --- load enrolled active sessions ---
    const userSessions = await this.participantRepository.find({
      where: { userId },
      relations: ['session', 'session.commitments'],
    });

    const activeSessions = userSessions
      .map((p) => p.session)
      .filter((s) => {
        const start = new Date(s.startDate); const end = new Date(s.endDate);
        return todayStart >= start && todayStart <= end;
      });

    if (!activeSessions.length) {
      return { daily: [], weekly: [], monthly: [] };
    }

    const allCommitments = activeSessions.flatMap((s) =>
      s.commitments.map((c) => ({ ...c, sessionName: s.name })),
    );

    const allIds = allCommitments.map((c) => c.id);
    if (!allIds.length) return { daily: [], weekly: [], monthly: [] };

    // fetch logs for all three windows in one query
    const logs = await this.logRepository
      .createQueryBuilder('log')
      .where('log.userId = :userId', { userId })
      .andWhere('log.commitmentId IN (:...allIds)', { allIds })
      .andWhere('log.date >= :monthStart', { monthStart: monthStart.toISOString() })
      .andWhere('log.date < :monthEnd', { monthEnd: monthEnd.toISOString() })
      .getMany();

    const hasLogInRange = (commitmentId: string, start: Date, end: Date) =>
      logs.some(
        (l) =>
          l.commitmentId === commitmentId &&
          l.status === LogStatus.COMPLETED &&
          new Date(l.date) >= start &&
          new Date(l.date) < end,
      );

    const toTask = (c: any, completed: boolean) => ({
      id: c.id,
      sessionName: c.sessionName,
      title: c.title,
      description: c.description,
      frequency: c.frequency,
      status: completed ? LogStatus.COMPLETED : LogStatus.PENDING,
    });

    return {
      daily: allCommitments
        .filter((c) => c.frequency === Frequency.DAILY)
        .map((c) => toTask(c, hasLogInRange(c.id, todayStart, todayEnd))),
      weekly: allCommitments
        .filter((c) => c.frequency === Frequency.WEEKLY)
        .map((c) => toTask(c, hasLogInRange(c.id, weekStart, weekEnd))),
      monthly: allCommitments
        .filter((c) => c.frequency === Frequency.MONTHLY)
        .map((c) => toTask(c, hasLogInRange(c.id, monthStart, monthEnd))),
    };
  }

  async upsertTaskLog(userId: string, commitmentId: string, status: LogStatus) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existing = await this.logRepository
      .createQueryBuilder('log')
      .where('log.userId = :userId', { userId })
      .andWhere('log.commitmentId = :commitmentId', { commitmentId })
      .andWhere('log.date >= :startOfDay', { startOfDay: today.toISOString() })
      .andWhere('log.date < :endOfDay', { endOfDay: tomorrow.toISOString() })
      .getOne();

    if (existing) {
      existing.status = status;
      return this.logRepository.save(existing);
    }

    const log = this.logRepository.create({
      userId,
      commitmentId,
      status,
      date: today,
    });

    return this.logRepository.save(log);
  }
}
