import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { TelegramService } from '../telegram/telegram.service.js';

@Injectable()
export class RemindersService {
	private readonly logger = new Logger(RemindersService.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private telegramService: TelegramService,
	) { }

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
	async sendEveningNudges() {
		const users = await this.getLinkedTelegramUsers();

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

	private getLinkedTelegramUsers() {
		return this.userRepository
			.createQueryBuilder('user')
			.select(['user.id', 'user.telegramId'])
			.where('user.telegramId IS NOT NULL')
			.andWhere(`user.telegramId <> ''`)
			.getMany();
	}
}
