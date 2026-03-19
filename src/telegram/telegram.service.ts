import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import TelegramBot = require('node-telegram-bot-api');
import { User } from '../entities/user.entity.js';
import { CommitmentLog, LogStatus } from '../entities/commitment-log.entity.js';
import { SessionsService } from '../sessions/sessions.service.js';

@Injectable()
export class TelegramService {
  private readonly bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
    private sessionsService: SessionsService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || token === 'your_telegram_bot_token') {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set correctly. Bot will not be started.');
      return;
    }

    // polling: false — updates arrive via the POST /telegram/webhook endpoint
    this.bot = new TelegramBot(token, { polling: false });

    // Register command / message handlers
    this.registerCommands();
    this.logger.log('Telegram Bot started in webhook mode.');
  }

  private registerCommands() {
    // ── /start ──────────────────────────────────────────────────────────────
    this.bot.onText(/\/start/, async (msg: TelegramBot.Message) => {
      const name = msg.from?.first_name ?? 'Friend';
      await this.sendMessage(
        msg.chat.id,
        `🙏 Hello ${name}! Welcome to *Pathfinder*.\n\n`
        + `Here is what you can do:\n\n`
        + `📋 /sessions — See all running sessions\n`
        + `📌 /mytasks — View your Daily, Weekly & Monthly tasks\n`
        + `✅ Send *DONE* — Mark all pending tasks for today as complete\n\n`
        + `You need to log in once via the web app to link your Telegram account.`,
        { parse_mode: 'Markdown' },
      );
    });

    // ── /sessions ────────────────────────────────────────────────────────────
    this.bot.onText(/\/sessions/, async (msg: TelegramBot.Message) => {
      const user = await this.userRepository.findOne({
        where: { telegramId: msg.chat.id.toString() },
      });
      const enrolledIds = user
        ? await this.sessionsService.getUserEnrolledSessionIds(user.id)
        : [];
      await this.sendSessionsCatalog(msg.chat.id, enrolledIds);
    });

    // ── /mytasks ─────────────────────────────────────────────────────────────
    this.bot.onText(/\/mytasks/, async (msg: TelegramBot.Message) => {
      await this.sendAllTasksMessage(msg.chat.id);
    });

    // ── plain text: "DONE" bulk-complete ─────────────────────────────────────
    this.bot.on('message', async (msg: TelegramBot.Message) => {
      // ignore commands and non-text
      if (!msg.text || msg.text.startsWith('/')) return;

      const text = msg.text.trim().toUpperCase();
      if (text !== 'DONE') return;

      const user = await this.userRepository.findOne({
        where: { telegramId: msg.chat.id.toString() },
      });

      if (!user) {
        await this.sendMessage(
          msg.chat.id,
          'Please log in via the web app to link your Telegram account first.',
        );
        return;
      }

      const allTasks = await this.sessionsService.getUserAllTasks(user.id);
      const pending = [
        ...allTasks.daily,
        ...allTasks.weekly,
        ...allTasks.monthly,
      ].filter((t: any) => t.status === LogStatus.PENDING);

      if (!pending.length) {
        await this.sendMessage(msg.chat.id, '🎉 All your tasks are already marked complete. Well done!');
        return;
      }

      await Promise.all(
        pending.map((t: any) =>
          this.sessionsService.upsertTaskLog(user.id, t.id, LogStatus.COMPLETED),
        ),
      );

      await this.sendMessage(
        msg.chat.id,
        `✅ Marked *${pending.length}* pending task(s) as complete.\n\nKeep it up! 💪`,
        { parse_mode: 'Markdown' },
      );
    });

    // ── callback_query: join / log individual tasks ───────────────────────────
    this.bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
      const chatId = query.message?.chat.id;
      const data = query.data;
      if (!chatId || !data) return;

      // ── join_session_<sessionId> ──────────────────────────────────────────
      if (data.startsWith('join_session_')) {
        const sessionId = data.slice('join_session_'.length);
        const user = await this.userRepository.findOne({
          where: { telegramId: chatId.toString() },
        });

        if (!user) {
          await this.bot.answerCallbackQuery(query.id, {
            text: '⚠️ Link your Telegram account via web login first.',
            show_alert: true,
          });
          return;
        }

        try {
          const result = await this.sessionsService.joinSession(sessionId, user.id);
          await this.bot.answerCallbackQuery(query.id, { text: '✅ You have joined this session!' });

          // remove the join button from the original message
          if (query.message) {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [[{ text: '✅ Joined', callback_data: 'noop' }]] },
              { chat_id: chatId, message_id: query.message.message_id },
            );
          }

          await this.sendOnboardingBrief(chatId, result.onboarding);
        } catch {
          await this.bot.answerCallbackQuery(query.id, {
            text: 'You are already enrolled in this session.',
            show_alert: true,
          });
        }
        return;
      }

      // ── log_commitment_<COMPLETED|SKIPPED>_<commitmentId> ────────────────
      if (data.startsWith('log_commitment_')) {
        // format: log_commitment_COMPLETED_<uuid>
        //         log_commitment_SKIPPED_<uuid>
        const withoutPrefix = data.slice('log_commitment_'.length);
        const separatorIndex = withoutPrefix.indexOf('_');
        const status = withoutPrefix.slice(0, separatorIndex) as LogStatus;
        const commitmentId = withoutPrefix.slice(separatorIndex + 1);

        const user = await this.userRepository.findOne({
          where: { telegramId: chatId.toString() },
        });

        if (!user) {
          await this.bot.answerCallbackQuery(query.id, {
            text: '⚠️ Link your Telegram account via web login first.',
            show_alert: true,
          });
          return;
        }

        try {
          await this.sessionsService.upsertTaskLog(user.id, commitmentId, status);

          const ack = status === LogStatus.COMPLETED ? '🙌 Marked complete!' : "⏭️ Skipped for now.";
          await this.bot.answerCallbackQuery(query.id, { text: ack });

          // collapse the buttons on the original message so it can't be tapped twice
          if (query.message) {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [[{ text: status === LogStatus.COMPLETED ? '✅ Done' : '⏭️ Skipped', callback_data: 'noop' }]] },
              { chat_id: chatId, message_id: query.message.message_id },
            );
          }
        } catch (error) {
          this.logger.error('Error logging commitment callback', error);
          await this.bot.answerCallbackQuery(query.id, { text: 'Could not save. Try again.' });
        }
        return;
      }

      // ── noop (already-acted buttons) ─────────────────────────────────────
      await this.bot.answerCallbackQuery(query.id);
    });
  }

  private async sendSessionsCatalog(chatId: number, enrolledIds: string[] = []) {
    const sessions = await this.sessionsService.findDiscoverableSessions();

    if (sessions.length === 0) {
      await this.sendMessage(chatId, 'No running or open sessions are available right now.');
      return;
    }

    await this.sendMessage(chatId, '📋 *Available Sessions*', { parse_mode: 'Markdown' });

    for (const session of sessions) {
      const isEnrolled = enrolledIds.includes(session.id);
      const label = `*${session.name}*\n`
        + `📅 Duration: ${session.durationDays} days\n`
        + `🗓 Start: ${new Date(session.startDate).toLocaleDateString()}\n`
        + `📌 Status: ${session.status}\n`
        + (session.spiritualFocus ? `🙏 Focus: ${session.spiritualFocus}\n` : '')
        + (session.description ? `\n${session.description}` : '');

      const button = isEnrolled
        ? { text: '✅ Already Joined', callback_data: 'noop' }
        : { text: '🙏 Join', callback_data: `join_session_${session.id}` };

      await this.sendMessage(chatId, label, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[button]] },
      });
    }
  }

  private async sendAllTasksMessage(chatId: number) {
    const user = await this.userRepository.findOne({
      where: { telegramId: chatId.toString() },
    });

    if (!user) {
      await this.sendMessage(
        chatId,
        '⚠️ Please log in via the web app to link your Telegram account, then try /mytasks again.',
      );
      return;
    }

    const allTasks = await this.sessionsService.getUserAllTasks(user.id);
    const { daily, weekly, monthly } = allTasks;

    if (!daily.length && !weekly.length && !monthly.length) {
      await this.sendMessage(
        chatId,
        '📭 You have no tasks assigned yet. Use /sessions to join a session.',
      );
      return;
    }

    await this.sendMessage(chatId, '📋 *Your Tasks*', { parse_mode: 'Markdown' });

    const sections: Array<{ label: string; tasks: any[] }> = [
      { label: '📅 *Daily Tasks*', tasks: daily },
      { label: '📆 *Weekly Tasks*', tasks: weekly },
      { label: '🗓 *Monthly Tasks*', tasks: monthly },
    ];

    for (const { label, tasks } of sections) {
      if (!tasks.length) {
        await this.sendMessage(chatId, `${label}\n_None assigned_`, { parse_mode: 'Markdown' });
        continue;
      }

      await this.sendMessage(chatId, label, { parse_mode: 'Markdown' });

      for (const task of tasks) {
        const isDone = task.status === LogStatus.COMPLETED;
        const isSkipped = task.status === LogStatus.SKIPPED;
        const taskText = `*${task.title}*`
          + (task.description ? `\n_${task.description}_` : '')
          + (task.sessionName ? `\n📌 ${task.sessionName}` : '')
          + (isDone ? '\n\n✅ Already completed' : '')
          + (isSkipped ? '\n\n⏭️ Skipped' : '');

        const buttons = isDone || isSkipped
          ? [[{ text: isDone ? '✅ Done' : '⏭️ Skipped', callback_data: 'noop' }]]
          : [[
              { text: '✅ Done', callback_data: `log_commitment_COMPLETED_${task.id}` },
              { text: '⏭️ Skip', callback_data: `log_commitment_SKIPPED_${task.id}` },
            ]];

        await this.sendMessage(chatId, taskText, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons },
        });
      }
    }
  }

  private formatRoadmapItems(items: Array<{ title: string; description?: string }>) {
    if (!items.length) {
      return '- None defined yet';
    }

    return items
      .map((item) => `- ${item.title}${item.description ? ` (${item.description})` : ''}`)
      .join('\n');
  }

  private async sendOnboardingBrief(chatId: number, onboarding: any) {
    const message = `You are enrolled in *${onboarding.sessionName}*.\n\n`
      + `Focus: ${onboarding.spiritualFocus}\n`
      + `Duration: ${onboarding.durationDays} Days\n\n`
      + `*Daily Activities*\n${this.formatRoadmapItems(onboarding.roadmap.daily)}\n\n`
      + `*Weekly Activities*\n${this.formatRoadmapItems(onboarding.roadmap.weekly)}\n\n`
      + `*Monthly Activities*\n${this.formatRoadmapItems(onboarding.roadmap.monthly)}\n\n`
      + `Use /mytasks each day and reply DONE after completion.`;

    await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async sendTodayDisciplineMessage(telegramId: string) {
    const user = await this.userRepository.findOne({ where: { telegramId } });
    if (!user) {
      return;
    }

    const payload = await this.sessionsService.getUserTodayTasks(user.id);
    const pendingTasks = payload.tasks.filter((task: any) => task.status !== LogStatus.COMPLETED);

    if (payload.tasks.length === 0) {
      await this.sendMessage(telegramId, 'No daily tasks are assigned for today.');
      return;
    }

    const lines = pendingTasks.map((task: any) => `* ${task.title}${task.description ? `: ${task.description}` : ''}`);
    const message = `*Today's Discipline:*\n${lines.join('\n')}\n\nReply 'DONE' when finished.`;

    await this.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
  }

  async sendEveningNudge(telegramId: string) {
    const user = await this.userRepository.findOne({ where: { telegramId } });
    if (!user) {
      return;
    }

    const payload = await this.sessionsService.getUserTodayTasks(user.id);
    const pendingTasks = payload.tasks.filter((task: any) => task.status === LogStatus.PENDING);

    if (!pendingTasks.length) {
      return;
    }

    const message = `Gentle reminder: you still have ${pendingTasks.length} pending task(s).\n`
      + `Open /mytasks and reply DONE when complete.`;
    await this.sendMessage(telegramId, message);
  }

  /**
   * Helper method to send daily reminders with interactive buttons.
   * This is intended to be called by a cron job or scheduled task.
   */
  async sendDailyReminder(chatId: string, commitmentLabel: string, commitmentId: string) {
    if (!this.bot) return;

    const message = `🔔 *Daily Reminder*\n\nTime for your commitment: *${commitmentLabel}*!`;
    const options: TelegramBot.SendMessageOptions = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Completed', callback_data: `log_commitment_COMPLETED_${commitmentId}` },
            { text: '⏭️ Skip', callback_data: `log_commitment_SKIPPED_${commitmentId}` },
          ]
        ]
      }
    };

    await this.sendMessage(chatId, message, options);
  }

  /**
   * Called by the webhook controller for every incoming Telegram update.
   * node-telegram-bot-api dispatches the update through all registered
   * onText / on('message') / on('callback_query') handlers automatically.
   */
  processUpdate(body: unknown) {
    if (!this.bot) return;
    try {
      this.bot.processUpdate(body as TelegramBot.Update);
    } catch (error) {
      this.logger.error('Error processing Telegram update', error);
    }
  }

  /**
   * Generic method to send messages
   */
  async sendMessage(chatId: number | string, text: string, options?: TelegramBot.SendMessageOptions) {
    if (!this.bot) return;

    try {
      await this.bot.sendMessage(chatId, text, options);
    } catch (error) {
      this.logger.error(`Failed to send message to ${chatId}`, error);
    }
  }
}
