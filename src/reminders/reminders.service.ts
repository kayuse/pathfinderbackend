import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

@Injectable()
export class RemindersService {
	private readonly logger = new Logger(RemindersService.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private telegramService: TelegramService,
		private sessionsService: SessionsService,
	) { }

	@Cron('0 */6 * * *')
  // @Cron('* * * * *')
	async sendPendingTaskRemindersEverySixHours() {
		const users = await this.getLinkedTelegramUsers();

		let remindedUsers = 0;
		for (const user of users) {
			if (!user.telegramId) {
				continue;
			}

			const pendingTasks = await this.sessionsService.getUserPendingTasksForReminder(user.id);

			if (!pendingTasks.length) {
				continue;
			}

			await this.telegramService.sendPendingTasksReminder(user.telegramId, pendingTasks);
			remindedUsers += 1;
		}

		this.logger.log(`6-hour pending task reminders sent to ${remindedUsers} user(s).`);
	}

	@Cron(CronExpression.EVERY_DAY_AT_6AM)
	async sendMorningDailyTasks() {
		const users = await this.getLinkedTelegramUsers();

		await Promise.all(
			users.map(async (user) => {
				if (!user.telegramId) {
					return;
				}
				await this.telegramService.sendTodayDisciplineMessage(user.telegramId);
			}),
		);

		this.logger.log(`Morning discipline messages processed for ${users.length} users.`);
	}

	@Cron(CronExpression.EVERY_DAY_AT_6PM)
	async sendEveningNudges() {		const users = await this.getLinkedTelegramUsers();

		await Promise.all(
			users.map(async (user) => {
				if (!user.telegramId) {
					return;
				}
				await this.telegramService.sendEveningNudge(user.telegramId);
			}),
		);

		this.logger.log(`Evening nudge messages processed for ${users.length} users.`);
	}

	@Cron('0,30 20-23 * * *') // Every 30 min from 8:00 PM to 11:30 PM (midnight)
	async sendTomorrowSessionStartReminders() {
		const enrollments = await this.sessionsService.getEnrolledUsersForSessionsStartingTomorrow();

		let reminded = 0;
		for (const enrollment of enrollments) {
			await this.telegramService.sendTomorrowSessionStartReminder(
				enrollment.telegramId,
				enrollment.sessionName,
				enrollment.commitments,
			);
			reminded += 1;
		}

		this.logger.log(`Tomorrow session-start reminders sent to ${reminded} user(s).`);
	}

	private getLinkedTelegramUsers() {
		return this.userRepository
			.createQueryBuilder('user')
			.select(['user.id', 'user.telegramId'])
			.where('user.telegramId IS NOT NULL')
			.andWhere(`user.telegramId <> ''`)
			.getMany();
	}
}
