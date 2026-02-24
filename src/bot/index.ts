import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';

import { CallbackHandler } from '../handlers/callbackHandler';
import { StartHandler } from '../handlers/startHandler';
import { ProgramsHandler } from '../handlers/programsHandler';
import { AdminAddProgramHandler } from '../handlers/adminAddProgramHandler';
import { BookingHandler } from '../handlers/bookingHandler';
import { AdminHandler } from '../handlers/adminHandler';
import { MyBookingsHandler } from '../handlers/myBookingsHandler';

import { NotificationService } from '../utils/notifications';

import { UserService } from '../database/services/UserService';
import { ProgramService } from '../database/services/ProgramService';
import { ApplicationService } from '../database/services/ApplicationService';
import { BookingService } from '../database/services/BookingService';
import { AdminService } from '../database/services/AdminService';
import { GuideService } from '../database/services/GuideService';
import { AdminGuideHandler } from '../handlers/adminGuideHandler';

export class DanceBot {
  private bot: TelegramBot;
  private handlers: {
    start: StartHandler;
    programs: ProgramsHandler;
    booking: BookingHandler;
    admin: AdminHandler;
    callback: CallbackHandler;
  };
  private adminGuideHandler: AdminGuideHandler;
  private adminAddProgramHandler: AdminAddProgramHandler;

  constructor() {
    this.bot = new TelegramBot(config.token, {
      polling: config.isDevelopment,
      webHook: !config.isDevelopment,
    });

    // ✅ Сервисы
    const userService = new UserService();
    const programService = new ProgramService();
    const applicationService = new ApplicationService();
    const bookingService = new BookingService();
    const adminService = new AdminService();
    const guideService = new GuideService();

    const notificationService = new NotificationService(this.bot, adminService);

    // ✅ Хендлеры
    const startHandler = new StartHandler(this.bot, userService, programService, guideService);

    const adminHandler = new AdminHandler(
      this.bot,
      adminService,
      applicationService,
      bookingService,
      programService
    );

    const bookingHandler = new BookingHandler(
      this.bot,
      applicationService,
      programService,
      userService,
      notificationService,
      bookingService
    );

    const programsHandler = new ProgramsHandler(this.bot, programService);

    // ✅ Админ добавление занятий
    this.adminAddProgramHandler = new AdminAddProgramHandler(
      this.bot,
      programService
    );

    const myBookingsHandler = new MyBookingsHandler(
      this.bot,
      bookingService,
      applicationService,
      userService
    );

    this.adminGuideHandler = new AdminGuideHandler(this.bot, guideService, adminService);

    const callbackHandler = new CallbackHandler(
      this.bot,
      adminHandler,
      bookingHandler,
      programsHandler,
      startHandler,
      myBookingsHandler,
      this.adminAddProgramHandler,
      this.adminGuideHandler,
    );

    this.handlers = {
      start: startHandler,
      programs: programsHandler,
      booking: bookingHandler,
      admin: adminHandler,
      callback: callbackHandler,
    };

    this.setupHandlers();
    
  }
  
  public getBot(): TelegramBot {
    return this.bot;
  }

  private setupHandlers(): void {
    // ✅ Команды
    this.bot.onText(/\/start/, (msg) =>
      this.handlers.start.handleStart(msg)
    );

    this.bot.onText(/\/programs/, (msg) =>
      this.handlers.programs.showPrograms(msg.chat.id)
    );

    this.bot.onText(/\/admin/, (msg) =>
      this.handlers.admin.showAdminPanel(msg.chat.id, msg.from?.id)
    );

    // ✅ Callback кнопки
    this.bot.on('callback_query', (query) =>
      this.handlers.callback.handle(query)
    );

    // ✅ Контакты
    this.bot.on('contact', (msg) => {
      if (msg.contact && msg.from) {
        this.handlers.booking.handleContact(
          msg.chat.id,
          msg.contact,
          msg.from
        );
      }
    });

    // ✅ Текстовые сообщения
    this.bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;

      const chatId = msg.chat.id;
      const text = msg.text;
      const user = msg.from;

      console.log(`📝 Сообщение от ${user?.id}: "${text}"`);

      try {
        // ==========================================
        // ✅ Админ добавляет гайд
        // ==========================================
        const handledByGuide = await this.adminGuideHandler.handleGuideInput(chatId, text);
        if (handledByGuide) {
          console.log("📚 Гайд ввод обработан");
          return;
        }

        // ==========================================
        // ✅ Админ добавляет ссылки в гайд (если мы в режиме добавления ссылок)
        // ==========================================
        if (this.adminGuideHandler.isAddingLinksMode()) {
          await this.adminGuideHandler.handleGuideLinks(chatId, text);
          return;
        }

        // ==========================================
        // ✅ Админ добавляет занятие
        // ==========================================
        const handledByAdmin = await this.adminAddProgramHandler.handleText(chatId, text);
        if (handledByAdmin) {
          console.log("🛠 Админский ввод обработан");
          return;
        }

        // ==========================================
        // 📢 Админ делает рассылку
        // ==========================================
        if (this.handlers.admin.isInBroadcastMode()) {
          const handled = await this.handlers.admin.handleBroadcastMessage(chatId, text);
          if (handled) return;
        }

        // ==========================================
        // Обычный пользовательский booking flow
        // ==========================================
        await this.handlers.booking.handleMessage(chatId, text, user);

      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
      }
    });

    // Ошибки
    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error.message);
    });
  }

  start(): void {
    console.log('🚀 Бот запущен');
  }
}

// Singleton export
let botInstance: DanceBot | null = null;

export const createBot = (): DanceBot => {
  if (!botInstance) {
    botInstance = new DanceBot();
    botInstance.start();
  }
  return botInstance;
};


export default createBot;