import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import TelegramBot = require('node-telegram-bot-api');
import OpenAI from 'openai';
import { User } from '../entities/user.entity.js';
import { CommitmentLog, LogStatus } from '../entities/commitment-log.entity.js';
import { SessionsService } from '../sessions/sessions.service.js';

type BotIntent =
  | 'LIST_SESSIONS'
  | 'LIST_MY_TASKS'
  | 'MARK_ALL_DONE'
  | 'HELP'
  | 'WELCOME'
  | 'UNKNOWN';

type OnboardingStep = 'NAME' | 'EMAIL' | 'PHONE';

type OnboardingDraft = {
  step: OnboardingStep;
  name?: string;
  email?: string;
  phoneNumber?: string;
  telegramUsername?: string;
  pendingJoinSessionId?: string;
};

@Injectable()
export class TelegramService {
  private readonly bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);
  private readonly openai?: OpenAI;
  private readonly onboardingState = new Map<string, OnboardingDraft>();

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CommitmentLog)
    private logRepository: Repository<CommitmentLog>,
    private sessionsService: SessionsService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const openAiKey = process.env.OPENAI_API_KEY;

    if (openAiKey) {
      this.openai = new OpenAI({ apiKey: openAiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY is not configured. Telegram intent detection will use fallback rules only.');
    }

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
        + `📋 /sessions — Overview (running subscribed, open applications, pending tasks)\n`
        + `📋 /running — Running sessions only\n`
        + `📌 /mytasks — View all tasks you can mark\n`
        + `📌 /tasks — Same as /mytasks\n`
        + `✅ Send *DONE* — Mark all pending tasks for today as complete\n\n`
        + `Use Telegram onboarding to set up your profile and join sessions.`,
        { parse_mode: 'Markdown' },
      );
    });

    // ── /sessions ────────────────────────────────────────────────────────────
    this.bot.onText(/\/sessions/, async (msg: TelegramBot.Message) => {
      await this.sendSessionsOverview(msg.chat.id);
    });

    // ── /running ───────────────────────────────────────────────────────────
    this.bot.onText(/\/running/, async (msg: TelegramBot.Message) => {
      const user = await this.userRepository.findOne({
        where: { telegramId: msg.chat.id.toString() },
      });
      const enrolledIds = user
        ? await this.sessionsService.getUserEnrolledSessionIds(user.id)
        : [];
      await this.sendRunningSessionsCatalog(msg.chat.id, enrolledIds);
    });

    // ── /mytasks ─────────────────────────────────────────────────────────────
    this.bot.onText(/\/mytasks/, async (msg: TelegramBot.Message) => {
      await this.sendAllTasksMessage(msg.chat.id);
    });

    // ── /tasks ─────────────────────────────────────────────────────────────
    this.bot.onText(/\/tasks/, async (msg: TelegramBot.Message) => {
      await this.sendAllTasksMessage(msg.chat.id);
    });

    // ── plain text: "DONE" bulk-complete ─────────────────────────────────────
    this.bot.on('message', async (msg: TelegramBot.Message) => {
      // ignore commands and non-text
      if (!msg.text || msg.text.startsWith('/')) return;

      const onboardingHandled = await this.handleOnboardingInput(
        msg.chat.id,
        msg.text,
        msg.from?.username,
      );
      if (onboardingHandled) return;

      const text = msg.text.trim();
      const intent = await this.detectIntent(text);

      switch (intent) {
        case 'LIST_SESSIONS': {
          await this.sendSessionsOverview(msg.chat.id);
          return;
        }
        case 'LIST_MY_TASKS': {
          await this.sendAllTasksMessage(msg.chat.id);
          return;
        }
        case 'MARK_ALL_DONE': {
          await this.markAllPendingDone(msg.chat.id);
          return;
        }
        case 'HELP': {
          await this.sendHelpMessage(msg.chat.id, msg.from?.first_name);
          return;
        }
        case 'WELCOME': {
          await this.sendWelcomeMessage(msg.chat.id, msg.from?.first_name);
          return;
        }
        default:
          await this.sendMessage(
            msg.chat.id,
            "I didn't catch that. Try: 'list my sessions', 'show my tasks', or 'mark all done'.",
          );
      }
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
          await this.beginTelegramOnboarding(chatId, query.from?.username, sessionId);
          await this.bot.answerCallbackQuery(query.id, {
            text: 'Let\'s set up your profile first.',
          });
          return;
        }

        try {
          await this.joinSessionFromTelegram(chatId, sessionId, user.id, query.message?.message_id);
          await this.bot.answerCallbackQuery(query.id, { text: '✅ You have joined this session!' });
        } catch {
          await this.bot.answerCallbackQuery(query.id, {
            text: 'You are already enrolled in this session.',
            show_alert: true,
          });
        }
        return;
      }

      // ── log_commitment_<COMPLETED|SKIPPED>_<commitmentId>  (legacy / sendDailyReminder) ─
      // ── log_<COMPLETED|SKIPPED>_<logId>                     (current) ──────────────────
      if (data.startsWith('log_commitment_') || data.startsWith('log_COMPLETED_') || data.startsWith('log_SKIPPED_')) {
        const user = await this.userRepository.findOne({
          where: { telegramId: chatId.toString() },
        });

        if (!user) {
          await this.beginTelegramOnboarding(chatId, query.from?.username);
          await this.bot.answerCallbackQuery(query.id, {
            text: 'Set up your profile first to track task progress.',
          });
          return;
        }

        let status: LogStatus;
        try {
          if (data.startsWith('log_commitment_')) {
            // legacy format: log_commitment_COMPLETED_<commitmentId>
            const withoutPrefix = data.slice('log_commitment_'.length);
            const separatorIndex = withoutPrefix.indexOf('_');
            status = withoutPrefix.slice(0, separatorIndex) as LogStatus;
            const commitmentId = withoutPrefix.slice(separatorIndex + 1);
            await this.sessionsService.upsertTaskLog(user.id, commitmentId, status);
          } else {
            // current format: log_COMPLETED_<logId> or log_SKIPPED_<logId>
            const withoutLog = data.slice('log_'.length); // e.g. 'COMPLETED_<logId>'
            const separatorIndex = withoutLog.indexOf('_');
            status = withoutLog.slice(0, separatorIndex) as LogStatus;
            const logId = withoutLog.slice(separatorIndex + 1);
            await this.sessionsService.updateLogById(logId, status);
          }

          const ack = status === LogStatus.COMPLETED ? '🙌 Marked complete!' : '⏭️ Skipped for now.';
          await this.bot.answerCallbackQuery(query.id, { text: ack });

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

  private async detectIntent(message: string): Promise<BotIntent> {
    // Primary: fast rule-based classification
    const normalized = message.trim().toLowerCase();

    if (normalized === 'done' || /mark\s+all\s+.*done/.test(normalized)) {
      return 'MARK_ALL_DONE';
    }
    if (/\b(my\s+tasks|tasks|todo|to-do)\b/.test(normalized)) {
      return 'LIST_MY_TASKS';
    }
    if (/\b(sessions|groups|challenges)\b/.test(normalized)) {
      return 'LIST_SESSIONS';
    }
    if (/\b(help|start|what can you do)\b/.test(normalized)) {
      return 'HELP';
    }
    if (/^(hi|hello|hey|howdy|greetings|good\s+(morning|evening|afternoon|day)|welcome|sup|what'?s\s+up)\b/.test(normalized)) {
      return 'WELCOME';
    }

    // Fallback: use OpenAI for anything the rules couldn't classify
    if (!this.openai) {
      return 'UNKNOWN';
    }

    try {
      const response = await this.openai.responses.create({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content:
              'You are an intent classifier for a Telegram productivity bot. '
              + 'Output ONLY one token from this set: LIST_SESSIONS, LIST_MY_TASKS, MARK_ALL_DONE, HELP, WELCOME, UNKNOWN. '
              + 'Use WELCOME when the message is a greeting or salutation with no specific action requested.',
          },
          {
            role: 'user',
            content: message,
          },
        ],
        temperature: 0,
      });

      const aiText = (response.output_text || '').trim().toUpperCase();
      const allowed: BotIntent[] = [
        'LIST_SESSIONS',
        'LIST_MY_TASKS',
        'MARK_ALL_DONE',
        'HELP',
        'WELCOME',
        'UNKNOWN',
      ];

      if (allowed.includes(aiText as BotIntent)) {
        return aiText as BotIntent;
      }
      return 'UNKNOWN';
    } catch (error) {
      this.logger.warn(`OpenAI intent classification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 'UNKNOWN';
    }
  }

  private async sendWelcomeMessage(chatId: number, firstName?: string) {
    const name = firstName ?? 'Friend';
    await this.sendMessage(
      chatId,
      `👋 Hi ${name}! Welcome to the *Threshing House Pathfinder Bot*, where you can track your daily disciplines and grow your relationship with Jesus. ✝️\n\n`
      + `To get started, try these commands:\n`
      + `/sessions — Active sessions overview\n`
      + `/running — Running sessions\n`
      + `/mytasks — Your pending tasks\n`
      + `/tasks — All tasks\n`
      + `/start — Restart\n\n`
      + `You can also try saying:\n`
      + `• "list my sessions"\n`
      + `• "show my tasks"\n`
      + `• "mark all done"\n\n`
      + `If your profile is not set yet, I will onboard you here in Telegram.`,
      { parse_mode: 'Markdown' },
    );
  }

  private async sendHelpMessage(chatId: number, firstName?: string) {
    const name = firstName ?? 'Friend';
    await this.sendMessage(
      chatId,
      `🙏 Hello ${name}! I can understand natural language commands.\n\n`
      + `Try saying:\n`
      + `• "list my sessions"\n`
      + `• "show my tasks"\n`
      + `• "mark all done"\n\n`
      + `Classic commands still work: /sessions, /running, /mytasks, /tasks, /start\n`
      + `If your profile is not set yet, I will onboard you here in Telegram.`,
    );
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private normalizePhoneNumber(input: string): string | null {
    const compact = input.replace(/\s+/g, '');
    if (!/^\+?[0-9]{7,15}$/.test(compact)) {
      return null;
    }
    return compact;
  }

  private async beginTelegramOnboarding(
    chatId: number,
    telegramUsername?: string,
    pendingJoinSessionId?: string,
  ) {
    const key = chatId.toString();
    const existing = this.onboardingState.get(key);

    if (existing) {
      if (pendingJoinSessionId) {
        existing.pendingJoinSessionId = pendingJoinSessionId;
        this.onboardingState.set(key, existing);
      }
      await this.sendMessage(chatId, '📝 Let\'s continue your onboarding. What is your full name?');
      return;
    }

    this.onboardingState.set(key, {
      step: 'NAME',
      telegramUsername,
      pendingJoinSessionId,
    });

    await this.sendMessage(
      chatId,
      '📝 Before we continue, let\'s create your profile here on Telegram.\n\nWhat is your full name?',
    );
  }

  private async handleOnboardingInput(
    chatId: number,
    rawText: string,
    telegramUsername?: string,
  ): Promise<boolean> {
    const key = chatId.toString();
    const draft = this.onboardingState.get(key);
    if (!draft) return false;

    const text = rawText.trim();
    if (!text) {
      await this.sendMessage(chatId, 'Please enter a valid value.');
      return true;
    }

    if (draft.step === 'NAME') {
      draft.name = text;
      draft.step = 'EMAIL';
      draft.telegramUsername = telegramUsername || draft.telegramUsername;
      this.onboardingState.set(key, draft);
      await this.sendMessage(chatId, 'Great. What is your email address?');
      return true;
    }

    if (draft.step === 'EMAIL') {
      if (!this.isValidEmail(text)) {
        await this.sendMessage(chatId, 'Please enter a valid email address (example: name@example.com).');
        return true;
      }

      const email = text.toLowerCase();
      const userWithEmail = await this.userRepository.findOne({ where: { email } });
      if (userWithEmail && userWithEmail.telegramId && userWithEmail.telegramId !== key) {
        await this.sendMessage(
          chatId,
          'That email is already linked to another Telegram account. Please provide another email.',
        );
        return true;
      }

      draft.email = email;
      draft.step = 'PHONE';
      this.onboardingState.set(key, draft);
      await this.sendMessage(chatId, 'Thanks. What is your phone number? Include country code if possible.');
      return true;
    }

    if (draft.step === 'PHONE') {
      const phoneNumber = this.normalizePhoneNumber(text);
      if (!phoneNumber) {
        await this.sendMessage(chatId, 'Please enter a valid phone number (digits, optional +, 7-15 digits).');
        return true;
      }

      draft.phoneNumber = phoneNumber;

      const existingByTelegram = await this.userRepository.findOne({ where: { telegramId: key } });
      let user = existingByTelegram;

      if (!user && draft.email) {
        const existingByEmail = await this.userRepository.findOne({ where: { email: draft.email } });
        if (existingByEmail) {
          user = existingByEmail;
        }
      }

      if (user) {
        user.name = draft.name || user.name;
        user.email = draft.email || user.email;
        user.phoneNumber = draft.phoneNumber || user.phoneNumber;
        user.telegramId = key;
        user.telegramUsername = draft.telegramUsername || user.telegramUsername;
      } else {
        user = this.userRepository.create({
          name: draft.name,
          email: draft.email,
          phoneNumber: draft.phoneNumber,
          telegramId: key,
          telegramUsername: draft.telegramUsername,
        });
      }

      const savedUser = await this.userRepository.save(user);
      this.onboardingState.delete(key);

      await this.sendMessage(
        chatId,
        '✅ Profile saved. Your Telegram account is now linked and you can join sessions directly.',
      );

      if (draft.pendingJoinSessionId) {
        try {
          await this.joinSessionFromTelegram(chatId, draft.pendingJoinSessionId, savedUser.id);
        } catch {
          await this.sendMessage(chatId, 'You are already enrolled in this session.');
        }
      }

      return true;
    }

    return false;
  }

  private async joinSessionFromTelegram(
    chatId: number,
    sessionId: string,
    userId: string,
    sourceMessageId?: number,
  ) {
    const result = await this.sessionsService.joinSession(sessionId, userId);

    if (sourceMessageId) {
      await this.bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: '✅ Joined', callback_data: 'noop' }]] },
        { chat_id: chatId, message_id: sourceMessageId },
      );
    }

    await this.sendOnboardingBrief(chatId, result.onboarding);
  }

  private async sendSessionsOverview(chatId: number) {
    const user = await this.userRepository.findOne({
      where: { telegramId: chatId.toString() },
    });
    const enrolledIds = user
      ? await this.sessionsService.getUserEnrolledSessionIds(user.id)
      : [];

    const discoverableSessions = await this.sessionsService.findDiscoverableSessions();
    const runningSubscribed = discoverableSessions.filter(
      (s) => s.status === 'RUNNING' && enrolledIds.includes(s.id),
    );
    const openForApplications = discoverableSessions.filter(
      (s) => s.status === 'OPEN_FOR_APPLICATION',
    );

    await this.sendMessage(chatId, '📋 *Sessions Overview*', { parse_mode: 'Markdown' });

    // 1) Running sessions already subscribed by the user
    if (!runningSubscribed.length) {
      await this.sendMessage(chatId, '✅ *Running Subscribed Sessions*\n_None right now._', {
        parse_mode: 'Markdown',
      });
    } else {
      await this.sendMessage(chatId, '✅ *Running Subscribed Sessions*', { parse_mode: 'Markdown' });
      for (const session of runningSubscribed) {
        const text = `*${session.name}*\n`
          + `📅 Duration: ${session.durationDays} days\n`
          + `🗓 Start: ${new Date(session.startDate).toLocaleDateString()}\n`
          + (session.spiritualFocus ? `🙏 Focus: ${session.spiritualFocus}\n` : '')
          + (session.description ? `\n${session.description}` : '');
        await this.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }
    }

    // 2) Sessions opened for applications
    if (!openForApplications.length) {
      await this.sendMessage(chatId, '🟢 *Open Sessions For Applications*\n_None right now._', {
        parse_mode: 'Markdown',
      });
    } else {
      await this.sendMessage(chatId, '🟢 *Open Sessions For Applications*', { parse_mode: 'Markdown' });
      for (const session of openForApplications) {
        const isEnrolled = enrolledIds.includes(session.id);
        const text = `*${session.name}*\n`
          + `📅 Duration: ${session.durationDays} days\n`
          + `🗓 Start: ${new Date(session.startDate).toLocaleDateString()}\n`
          + `📌 Status: ${session.status}\n`
          + (session.spiritualFocus ? `🙏 Focus: ${session.spiritualFocus}\n` : '')
          + (session.description ? `\n${session.description}` : '');

        const button = isEnrolled
          ? { text: '✅ Already Joined', callback_data: 'noop' }
          : { text: '🙏 Join', callback_data: `join_session_${session.id}` };

        await this.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[button]] },
        });
      }
    }

    // 3) Pending tasks to be done for all subscribed active sessions
    if (!user) {
      await this.sendMessage(
        chatId,
        '📌 *Pending Tasks (Subscribed Sessions)*\nComplete Telegram onboarding first by tapping Join on any open session.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const allTasks = await this.sessionsService.getUserAllTasks(user.id);
    const pendingTasks = [...allTasks.daily, ...allTasks.weekly, ...allTasks.monthly, ...(allTasks.custom ?? [])]
      .filter((task) => task.status === LogStatus.PENDING);

    if (!pendingTasks.length) {
      await this.sendMessage(chatId, '📌 *Pending Tasks (Subscribed Sessions)*\n🎉 No pending tasks right now.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    await this.sendMessage(chatId, `📌 *Pending Tasks (Subscribed Sessions): ${pendingTasks.length}*`, {
      parse_mode: 'Markdown',
    });

    for (const task of pendingTasks) {
      const taskText = `*${task.title}*`
        + (task.description ? `\n_${task.description}_` : '')
        + (task.sessionName ? `\n📌 ${task.sessionName}` : '')
        + (task.frequency ? `\n⏱ ${task.frequency}` : '');

      await this.sendMessage(chatId, taskText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Done', callback_data: `log_COMPLETED_${task.logId}` },
            { text: '⏭️ Skip', callback_data: `log_SKIPPED_${task.logId}` },
          ]],
        },
      });
    }
  }

  private async markAllPendingDone(chatId: number) {
    const user = await this.userRepository.findOne({
      where: { telegramId: chatId.toString() },
    });

    if (!user) {
      await this.beginTelegramOnboarding(chatId);
      await this.sendMessage(
        chatId,
        'Complete Telegram onboarding first, then I can mark tasks for you.',
      );
      return;
    }

    const allTasks = await this.sessionsService.getUserAllTasks(user.id);
    const pending = [
      ...allTasks.daily,
      ...allTasks.weekly,
      ...allTasks.monthly,
      ...(allTasks.custom ?? []),
    ].filter((t: any) => t.status === LogStatus.PENDING);

    if (!pending.length) {
      await this.sendMessage(chatId, '🎉 All your tasks are already marked complete. Well done!');
      return;
    }

    await Promise.all(
      pending.map((t: any) =>
        this.sessionsService.updateLogById(t.logId, LogStatus.COMPLETED),
      ),
    );

    await this.sendMessage(
      chatId,
      `✅ Marked *${pending.length}* pending task(s) as complete.\n\nKeep it up! 💪`,
      { parse_mode: 'Markdown' },
    );
  }

  private async sendRunningSessionsCatalog(chatId: number, enrolledIds: string[] = []) {
    const sessions = await this.sessionsService.findRunningSessions();

    if (sessions.length === 0) {
      await this.sendMessage(chatId, 'No running sessions are available right now.');
      return;
    }

    await this.sendMessage(chatId, '📋 *Running Sessions*', { parse_mode: 'Markdown' });

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
      await this.beginTelegramOnboarding(chatId);
      await this.sendMessage(
        chatId,
        '⚠️ Let\'s set up your profile first. I just started onboarding in this chat.',
      );
      return;
    }

    const allTasks = await this.sessionsService.getUserAllTasks(user.id);
    const { daily, weekly, monthly, custom = [] } = allTasks;
    const statusOverview = await this.sessionsService.getUserTaskStatusOverview(user.id);

    if (!daily.length && !weekly.length && !monthly.length && !custom.length) {
      await this.sendMessage(
        chatId,
        '📭 You have no tasks assigned yet. Use /sessions to join a session.',
      );
      return;
    }

    await this.sendMessage(
      chatId,
      `🤖 Task Status Summary\n${statusOverview.summaryText}\n\nCompleted: ${statusOverview.counts.completed}\nPending: ${statusOverview.counts.pending}\nIncomplete (missed from previous day): ${statusOverview.counts.incomplete}`,
    );

    await this.sendMessage(chatId, '📋 *Your Tasks*', { parse_mode: 'Markdown' });

    if (statusOverview.completedTasks.length) {
      const completedLines = statusOverview.completedTasks
        .map((task: any) => `• ${task.title}${task.sessionName ? ` (${task.sessionName})` : ''}`)
        .join('\n');
      await this.sendMessage(
        chatId,
        `✅ *Completed Today*\n${completedLines}`,
        { parse_mode: 'Markdown' },
      );
    } else {
      await this.sendMessage(chatId, '✅ *Completed Today*\n_None yet._', { parse_mode: 'Markdown' });
    }

    if (statusOverview.incompleteTasks.length) {
      const incompleteLines = statusOverview.incompleteTasks
        .map((task: any) => `• ${task.title}${task.sessionName ? ` (${task.sessionName})` : ''}`)
        .join('\n');
      await this.sendMessage(
        chatId,
        `⚠️ *Incomplete (Missed Previous Day)*\n${incompleteLines}`,
        { parse_mode: 'Markdown' },
      );
    } else {
      await this.sendMessage(chatId, '⚠️ *Incomplete (Missed Previous Day)*\n_None. Great consistency!_', {
        parse_mode: 'Markdown',
      });
    }

    const sections: Array<{ label: string; tasks: any[] }> = [
      { label: '📅 *Daily Tasks*', tasks: daily },
      { label: '📆 *Weekly Tasks*', tasks: weekly },
      { label: '🗓 *Monthly Tasks*', tasks: monthly },
      { label: '🎯 *One-Time Tasks*', tasks: custom },
    ];

    for (const { label, tasks } of sections) {
      if (!tasks.length) {
        await this.sendMessage(chatId, `${label}\n_None assigned_`, { parse_mode: 'Markdown' });
        continue;
      }

      const markableTasks = tasks.filter((task) => task.status === LogStatus.PENDING);

      if (!markableTasks.length) {
        await this.sendMessage(chatId, `${label}\n✅ All tasks already marked for this section.`, {
          parse_mode: 'Markdown',
        });
        continue;
      }

      await this.sendMessage(chatId, label, { parse_mode: 'Markdown' });

      for (const task of markableTasks) {
        const taskText = `*${task.title}*`
          + (task.description ? `\n_${task.description}_` : '')
          + (task.sessionName ? `\n📌 ${task.sessionName}` : '');

        const buttons = [[
          { text: '✅ Done', callback_data: `log_COMPLETED_${task.logId}` },
          { text: '⏭️ Skip', callback_data: `log_SKIPPED_${task.logId}` },
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

  async sendTomorrowSessionStartReminder(
    telegramId: string,
    sessionName: string,
    commitments: Array<{ title: string; description?: string; frequency: string }>,
  ) {
    const lines = commitments
      .map((c) => `• *${c.title}*${c.description ? ` — ${c.description}` : ''} _(${c.frequency.toLowerCase()})_`)
      .join('\n');

    const message =
      `🔔 *Heads up!* Your session *${sessionName}* starts *tomorrow*.\n\n`
      + `Here's what you'll need to do:\n${lines}\n\n`
      + `Get ready and stay committed! 🙏`;

    await this.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
  }

  async sendPendingTasksReminder(    telegramId: string,
    pendingTasks: Array<{
      title: string;
      description?: string;
      sessionName?: string;
      date: string;
      startDate: string;
      endDate: string;
    }>,
  ) {
    if (!pendingTasks.length) {
      return;
    }

    const preview = pendingTasks
      .slice(0, 5)
      .map((task) => `• ${task.title}${task.sessionName ? ` (${task.sessionName})` : ''} - due ${task.endDate}`)
      .join('\n');

    const moreCount = pendingTasks.length > 5 ? `\n...and ${pendingTasks.length - 5} more.` : '';
    const message = `⏰ Reminder: you have ${pendingTasks.length} pending task(s).\n\n${preview}${moreCount}\n\nOpen /mytasks to mark them complete.`;

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
