import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { Session } from '../entities/session.entity.js';
import { Commitment, Frequency } from '../entities/commitment.entity.js';
import { SessionParticipant } from '../entities/session-participant.entity.js';
import { CommitmentLog, LogStatus } from '../entities/commitment-log.entity.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { CreateCommitmentDto } from './dto/create-commitment.dto.js';

type SessionStatus = 'RUNNING' | 'OPEN_FOR_APPLICATION' | 'UPCOMING' | 'COMPLETED' | 'CLOSED';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly openai?: OpenAI;

  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(Commitment)
    private commitmentRepository: Repository<Commitment>,
    @InjectRepository(SessionParticipant)
    private participantRepository: Repository<SessionParticipant>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
  ) {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (openAiKey) {
      this.openai = new OpenAI({ apiKey: openAiKey });
    }
  }

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
    if (session.isClosed) {
      return 'CLOSED';
    }

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

  private normalizeToDateOnly(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private formatDateOnly(value: Date): string {
    return this.normalizeToDateOnly(value).toISOString().slice(0, 10);
  }

  private getTaskScheduleStartDate(session: Session, joinedAt: Date): Date {
    const sessionStart = this.normalizeToDateOnly(new Date(session.startDate));
    const joinedDate = this.normalizeToDateOnly(new Date(joinedAt));
    return joinedDate > sessionStart ? joinedDate : sessionStart;
  }

  private buildScheduleDates(
    startDate: Date,
    endDate: Date,
    frequency: Frequency,
  ): Array<{ occurrenceDate: Date; taskStartDate: Date; taskEndDate: Date }> {
    const slots: Array<{ occurrenceDate: Date; taskStartDate: Date; taskEndDate: Date }> = [];
    const start = this.normalizeToDateOnly(startDate);
    const end = this.normalizeToDateOnly(endDate);

    if (start > end) {
      return slots;
    }

    if (frequency === Frequency.DAILY) {
      const cursor = new Date(start);
      while (cursor <= end) {
        const day = new Date(cursor);
        slots.push({ occurrenceDate: day, taskStartDate: day, taskEndDate: day });
        cursor.setDate(cursor.getDate() + 1);
      }
      return slots;
    }

    if (frequency === Frequency.WEEKLY) {
      const cursor = new Date(start);
      while (cursor <= end) {
        const slotStart = new Date(cursor);
        const slotEndRaw = new Date(cursor);
        slotEndRaw.setDate(slotEndRaw.getDate() + 6);
        const slotEnd = slotEndRaw <= end ? slotEndRaw : new Date(end);
        slots.push({ occurrenceDate: slotStart, taskStartDate: slotStart, taskEndDate: slotEnd });
        cursor.setDate(cursor.getDate() + 7);
      }
      return slots;
    }

    if (frequency === Frequency.MONTHLY) {
      const anchorDay = start.getDate();
      const cursor = new Date(start);
      while (cursor <= end) {
        const slotStart = new Date(cursor);
        // Advance to the same day next month
        const nextOccurrence = new Date(cursor);
        nextOccurrence.setDate(1);
        nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
        const maxDay = new Date(nextOccurrence.getFullYear(), nextOccurrence.getMonth() + 1, 0).getDate();
        nextOccurrence.setDate(Math.min(anchorDay, maxDay));
        // Window ends the day before the next occurrence, capped at session end
        const slotEndRaw = new Date(nextOccurrence);
        slotEndRaw.setDate(slotEndRaw.getDate() - 1);
        const slotEnd = slotEndRaw <= end ? slotEndRaw : new Date(end);
        slots.push({ occurrenceDate: slotStart, taskStartDate: slotStart, taskEndDate: slotEnd });
        cursor.setTime(nextOccurrence.getTime());
      }
      return slots;
    }

    // CUSTOM: single task whose window spans the entire enrollment period.
    slots.push({ occurrenceDate: start, taskStartDate: start, taskEndDate: end });
    return slots;
  }

  private async seedParticipantCommitmentTasks(participant: SessionParticipant, session: Session): Promise<number> {
    if (!session.commitments?.length) {
      return 0;
    }

    const scheduleStart = this.getTaskScheduleStartDate(session, participant.joinedAt || new Date());
    const scheduleEnd = this.normalizeToDateOnly(new Date(session.endDate));
    if (scheduleStart > scheduleEnd) {
      return 0;
    }

    const values = session.commitments.flatMap((commitment) => {
      const slots = this.buildScheduleDates(scheduleStart, scheduleEnd, commitment.frequency);
      return slots.map(({ occurrenceDate, taskStartDate, taskEndDate }) => ({
        userId: participant.userId,
        commitmentId: commitment.id,
        date: this.formatDateOnly(occurrenceDate),
        startDate: this.formatDateOnly(taskStartDate),
        endDate: this.formatDateOnly(taskEndDate),
        status: LogStatus.PENDING,
      }));
    });

    if (!values.length) {
      return 0;
    }

    const result = await this.logRepository
      .createQueryBuilder()
      .insert()
      .into(CommitmentLog)
      .values(values)
      .orIgnore()
      .execute();

    return result.identifiers.length;
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

  async findRunningSessions() {
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
      .filter((session) => session.status === 'RUNNING');
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

  async closeSession(id: string) {
    const session = await this.findOne(id);

    if (session.isClosed) {
      return session;
    }

    session.isClosed = true;
    session.openForApplication = false;

    return this.sessionRepository.save(session);
  }

  async joinSession(sessionId: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['commitments'],
    });

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
      const createdTasks = await this.seedParticipantCommitmentTasks(savedParticipant, session);
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
          createdTasks,
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
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (session.isClosed) {
      throw new ConflictException('Cannot create a commitment for a closed session');
    }

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
      .filter((session) => this.getSessionStatus(session) === 'RUNNING');

    const commitmentIds = activeSessions.flatMap((session) => session.commitments.map((c) => c.id));

    if (commitmentIds.length === 0) {
      return {
        date: this.formatDateOnly(today),
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

    const commitmentById = new Map(
      activeSessions.flatMap((session) =>
        session.commitments.map((commitment) => [
          commitment.id,
          {
            commitment,
            session,
          },
        ]),
      ),
    );

    const tasks = logs
      .map((log) => {
        const context = commitmentById.get(log.commitmentId);
        if (!context) {
          return null;
        }

        return {
          id: context.commitment.id,
          sessionId: context.session.id,
          sessionName: context.session.name,
          title: context.commitment.title,
          description: context.commitment.description,
          frequency: context.commitment.frequency,
          status: log.status,
          date: this.formatDateOnly(new Date(log.date)),
          startDate: log.startDate ? this.formatDateOnly(new Date(log.startDate)) : this.formatDateOnly(new Date(log.date)),
          endDate: log.endDate ? this.formatDateOnly(new Date(log.endDate)) : this.formatDateOnly(new Date(log.date)),
        };
      })
      .filter((task) => !!task);

    const completedCount = tasks.filter((task) => task.status === LogStatus.COMPLETED).length;
    const completionRate = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

    return {
      date: this.formatDateOnly(today),
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
      .filter((session) => this.getSessionStatus(session) === 'RUNNING');

    if (!activeSessions.length) {
      return { daily: [], weekly: [], monthly: [] };
    }

    const allCommitments = activeSessions.flatMap((s) =>
      s.commitments.map((c) => ({ ...c, sessionName: s.name, session: s })),
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

    const commitmentById = new Map(allCommitments.map((c: any) => [c.id, c]));

    const toTask = (log: CommitmentLog) => {
      const commitment: any = commitmentById.get(log.commitmentId);
      if (!commitment) {
        return null;
      }

      return {
        id: commitment.id,
        sessionName: commitment.sessionName,
        title: commitment.title,
        description: commitment.description,
        frequency: commitment.frequency,
        status: log.status,
        date: this.formatDateOnly(new Date(log.date)),
        startDate: log.startDate ? this.formatDateOnly(new Date(log.startDate)) : this.formatDateOnly(new Date(log.date)),
        endDate: log.endDate ? this.formatDateOnly(new Date(log.endDate)) : this.formatDateOnly(new Date(log.date)),
      };
    };

    const inRange = (value: Date, start: Date, end: Date) => value >= start && value < end;

    const daily = logs
      .filter((log) => {
        const commitment: any = commitmentById.get(log.commitmentId);
        return !!commitment
          && commitment.frequency === Frequency.DAILY
          && inRange(new Date(log.date), todayStart, todayEnd);
      })
      .map(toTask)
      .filter((task) => !!task);

    const weekly = logs
      .filter((log) => {
        const commitment: any = commitmentById.get(log.commitmentId);
        return !!commitment
          && commitment.frequency === Frequency.WEEKLY
          && inRange(new Date(log.date), weekStart, weekEnd);
      })
      .map(toTask)
      .filter((task) => !!task);

    const monthly = logs
      .filter((log) => {
        const commitment: any = commitmentById.get(log.commitmentId);
        return !!commitment
          && commitment.frequency === Frequency.MONTHLY
          && inRange(new Date(log.date), monthStart, monthEnd);
      })
      .map(toTask)
      .filter((task) => !!task);

    return { daily, weekly, monthly };
  }

  async getUserPendingTasksForReminder(userId: string) {
    const today = this.normalizeToDateOnly(new Date());
    const userSessions = await this.participantRepository.find({
      where: { userId },
      relations: ['session', 'session.commitments'],
    });

    const activeSessions = userSessions
      .map((participant) => participant.session)
      .filter((session) => this.getSessionStatus(session) === 'RUNNING');

    const commitmentIds = activeSessions.flatMap((session) => session.commitments.map((c) => c.id));
    if (!commitmentIds.length) {
      return [];
    }

    const pendingLogs = await this.logRepository
      .createQueryBuilder('log')
      .where('log.userId = :userId', { userId })
      .andWhere('log.commitmentId IN (:...commitmentIds)', { commitmentIds })
      .andWhere('log.status = :status', { status: LogStatus.PENDING })
      .andWhere('log.date = :today', { today: this.formatDateOnly(today) })
      .orderBy('log.date', 'ASC')
      .getMany();

    const commitmentById = new Map(
      activeSessions.flatMap((session) =>
        session.commitments.map((commitment) => [commitment.id, { commitment, session }]),
      ),
    );

    return pendingLogs
      .map((log) => {
        const context = commitmentById.get(log.commitmentId);
        if (!context) {
          return null;
        }

        return {
          id: context.commitment.id,
          title: context.commitment.title,
          description: context.commitment.description,
          frequency: context.commitment.frequency,
          sessionName: context.session.name,
          date: this.formatDateOnly(new Date(log.date)),
          startDate: log.startDate ? this.formatDateOnly(new Date(log.startDate)) : this.formatDateOnly(new Date(log.date)),
          endDate: log.endDate ? this.formatDateOnly(new Date(log.endDate)) : this.formatDateOnly(new Date(log.date)),
        };
      })
      .filter((task) => !!task);
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

  private async generateTaskStatusSummaryText(input: {
    date: string;
    missedDate: string;
    completedCount: number;
    pendingCount: number;
    incompleteCount: number;
  }): Promise<string> {
    const fallbackText = `For ${input.date}: completed ${input.completedCount}, pending ${input.pendingCount}, and incomplete ${input.incompleteCount} task(s). Incomplete means the task was not completed on ${input.missedDate}.`;

    if (!this.openai) {
      return fallbackText;
    }

    try {
      const response = await this.openai.responses.create({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content:
              'You write brief, supportive daily status summaries for discipline tasks. '
              + 'Return plain text only, max 2 sentences, and include completed, pending, and incomplete counts.',
          },
          {
            role: 'user',
            content:
              `Date: ${input.date}. Completed: ${input.completedCount}. Pending: ${input.pendingCount}. `
              + `Incomplete (from ${input.missedDate}): ${input.incompleteCount}.`,
          },
        ],
        temperature: 0.2,
      });

      return response.output_text?.trim() || fallbackText;
    } catch (error) {
      this.logger.warn(`OpenAI task status summary failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return fallbackText;
    }
  }

  async getUserTaskStatusOverview(userId: string, targetDateInput?: string) {
    const todayPayload = await this.getUserTodayTasks(userId, targetDateInput);

    const targetDate = new Date(todayPayload.date);
    targetDate.setHours(0, 0, 0, 0);

    const previousDate = new Date(targetDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateIso = previousDate.toISOString().slice(0, 10);

    const previousDayPayload = await this.getUserTodayTasks(userId, previousDateIso);

    const completedTasks = todayPayload.tasks.filter((task) => task.status === LogStatus.COMPLETED);
    const pendingTasks = todayPayload.tasks.filter((task) => task.status === LogStatus.PENDING);
    const incompleteTasks = previousDayPayload.tasks
      .filter((task) => task.status !== LogStatus.COMPLETED)
      .map((task) => ({
        ...task,
        missedOn: previousDayPayload.date,
      }));

    const summaryText = await this.generateTaskStatusSummaryText({
      date: todayPayload.date,
      missedDate: previousDayPayload.date,
      completedCount: completedTasks.length,
      pendingCount: pendingTasks.length,
      incompleteCount: incompleteTasks.length,
    });

    return {
      date: todayPayload.date,
      missedDate: previousDayPayload.date,
      completionRate: todayPayload.completionRate,
      summaryText,
      counts: {
        completed: completedTasks.length,
        pending: pendingTasks.length,
        incomplete: incompleteTasks.length,
      },
      completedTasks,
      pendingTasks,
      incompleteTasks,
    };
  }
}
