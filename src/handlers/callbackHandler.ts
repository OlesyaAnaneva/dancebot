import TelegramBot from 'node-telegram-bot-api';
import { AdminHandler } from './adminHandler';
import { BookingHandler } from './bookingHandler';
import { ProgramsHandler } from './programsHandler';
import { StartHandler } from './startHandler';
import { Logger } from '../utils/logger';
import { AdminAddProgramHandler } from './adminAddProgramHandler';
import { MyBookingsHandler } from './myBookingsHandler';
import { AdminGuideHandler } from './adminGuideHandler';
import { config } from '../config';

// Константы для callback данных
const CALLBACK_PREFIXES = {
  GUIDE: 'guide_',
  ADMIN_GUIDE: 'admin_guide_',
  GUIDE_CATEGORY: 'guide_category_',
  GUIDE_LINKS_DONE: 'guide_links_done',
  SHOW_PHONE: 'show_phone_number',
  BROADCAST_ALL: 'broadcast_all',
  BROADCAST_ACTIVE: 'broadcast_active',
  BROADCAST_PROGRAM: 'broadcast_program_',
  ADMIN_DELETE: 'admin_delete_',
  IND: 'ind_',
  IND_DAYS_DONE: 'ind_days_done',
  BROADCAST_CONFIRM: 'broadcast_confirm',
  BROADCAST_CANCEL: 'broadcast_cancel',
  NOTES_SKIP: 'notes_skip',
  ADMIN: 'admin_',
  ADD_TYPE: 'add_type_',
  ADD_CONFIRM: 'add_confirm',
  DURATION: 'duration_',
  SINGLE_DATE: 'single_date_',
  TOGGLE_FULL: 'toggle_full_',
  FULL_DONE: 'full_done',
  OPTION_FULL: 'option_full_',
  BOOK: 'book_',
  OPTION: 'option_',
  NAV_MY_BOOKINGS: 'nav_my_bookings',
  NAV_SCHEDULE: 'nav_schedule',
  NAV: 'nav_',
  PROGRAM: 'program_',
  BOOKING_CONFIRM: 'booking_confirm',
  BOOKING_CANCEL: 'booking_cancel',
  PAYMENT: 'payment_',
  ADMIN_CONFIRM: 'admin_confirm_',
  ADMIN_REJECT: 'admin_reject_',
  ADMIN_CALL: 'admin_call_',
} as const;

// Типы для callback данных
type CallbackData = string;

export class CallbackHandler {
  // Маппинг callback префиксов на обработчики
  private readonly handlers: Map<string, (data: string, query: TelegramBot.CallbackQuery) => Promise<void>>;

  constructor(
    private bot: TelegramBot,
    private adminHandler: AdminHandler,
    private bookingHandler: BookingHandler,
    private programsHandler: ProgramsHandler,
    private startHandler: StartHandler,
    private myBookingsHandler: MyBookingsHandler,
    private adminAddProgramHandler: AdminAddProgramHandler,
    private adminGuideHandler: AdminGuideHandler,
  ) {
    this.handlers = this.initializeHandlers();
  }

  private initializeHandlers(): Map<string, (data: string, query: TelegramBot.CallbackQuery) => Promise<void>> {
    const handlers = new Map();

    // Guide handlers
    handlers.set(CALLBACK_PREFIXES.ADMIN_GUIDE, (data: any, query: TelegramBot.CallbackQuery) =>
      this.adminGuideHandler.handleCallback(query));
    handlers.set(CALLBACK_PREFIXES.GUIDE_CATEGORY, (data: any, query: TelegramBot.CallbackQuery) =>
      this.adminGuideHandler.handleCallback(query));
    handlers.set(CALLBACK_PREFIXES.GUIDE_LINKS_DONE, (data: any, query: TelegramBot.CallbackQuery) =>
      this.adminGuideHandler.handleCallback(query));
    handlers.set(CALLBACK_PREFIXES.GUIDE, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handleUserGuide(data, query.message?.chat.id));

    // Broadcast handlers
    handlers.set(CALLBACK_PREFIXES.BROADCAST_ALL, (data: any, query: { message: { chat: { id: number; }; }; from: { id: number | undefined; }; }) =>
      this.adminHandler.handleSegmentSelection(query.message?.chat.id, 'all', query.from.id));
    handlers.set(CALLBACK_PREFIXES.BROADCAST_ACTIVE, (data: any, query: { message: { chat: { id: number; }; }; from: { id: number | undefined; }; }) =>
      this.adminHandler.handleSegmentSelection(query.message?.chat.id, 'active', query.from.id));
    handlers.set(CALLBACK_PREFIXES.BROADCAST_CONFIRM, (data: any, query: { message: { chat: { id: number; }; }; from: { id: number | undefined; }; }) =>
      this.adminHandler.confirmBroadcast(query.message?.chat.id, query.from.id));
    handlers.set(CALLBACK_PREFIXES.BROADCAST_CANCEL, (data: any, query: { message: { chat: { id: number; }; }; from: { id: number | undefined; }; }) =>
      this.adminHandler.cancelBroadcast(query.message?.chat.id, query.from.id));

    // Admin program handlers
    handlers.set(CALLBACK_PREFIXES.IND, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.adminAddProgramHandler.handleCallback(query.message?.chat.id, data));
    handlers.set(CALLBACK_PREFIXES.IND_DAYS_DONE, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.adminAddProgramHandler.handleCallback(query.message?.chat.id, data));
    handlers.set(CALLBACK_PREFIXES.DURATION, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.adminAddProgramHandler.handleCallback(query.message?.chat.id, data));

    // Booking handlers
    handlers.set(CALLBACK_PREFIXES.NOTES_SKIP, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.bookingHandler.handleNotes(query.message?.chat.id, 'нет'));
    handlers.set(CALLBACK_PREFIXES.SINGLE_DATE, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handleSingleDate(data, query.message?.chat.id));
    handlers.set(CALLBACK_PREFIXES.TOGGLE_FULL, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handleToggleFull(data, query.message?.chat.id));
    handlers.set(CALLBACK_PREFIXES.FULL_DONE, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.bookingHandler.finishFullBooking(query.message?.chat.id));
    handlers.set(CALLBACK_PREFIXES.OPTION_FULL, (data: string, query: TelegramBot.CallbackQuery) =>
      this.handleOptionFull(data, query));
    handlers.set(CALLBACK_PREFIXES.OPTION, (data: string, query: TelegramBot.CallbackQuery) =>
      this.handleOption(data, query));
    handlers.set(CALLBACK_PREFIXES.BOOK, (data: string, query: TelegramBot.CallbackQuery) =>
      this.handleBook(data, query));
    handlers.set(CALLBACK_PREFIXES.BOOKING_CONFIRM, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.bookingHandler.confirmBooking(query.message?.chat.id));
    handlers.set(CALLBACK_PREFIXES.BOOKING_CANCEL, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.bookingHandler.cancelBooking(query.message?.chat.id));
    handlers.set(CALLBACK_PREFIXES.PAYMENT, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handlePayment(data, query.message?.chat.id));

    // Navigation handlers
    handlers.set(CALLBACK_PREFIXES.NAV_MY_BOOKINGS, (data: any, query: { message: { chat: { id: number; }; }; from: { id: number; }; }) =>
      this.myBookingsHandler.showMyBookings(query.message?.chat.id, query.from.id));
    handlers.set(CALLBACK_PREFIXES.NAV_SCHEDULE, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.startHandler.handleNavigation(query.message?.chat.id, 'schedule'));
    handlers.set(CALLBACK_PREFIXES.NAV, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handleNavigation(query.message?.chat.id, data));

    // Program handlers
    handlers.set(CALLBACK_PREFIXES.PROGRAM, (data: string, query: { message: { chat: { id: number; }; }; }) =>
      this.handleProgram(data, query.message?.chat.id));

    // Show phone
    handlers.set(CALLBACK_PREFIXES.SHOW_PHONE, (data: any, query: { message: { chat: { id: number; }; }; }) =>
      this.handleShowPhone(query.message?.chat.id));

    return handlers;
  }

  async handle(query: TelegramBot.CallbackQuery): Promise<void> {
    const startTime = Date.now();

    try {
      // Валидация
      if (!this.validateCallback(query)) {
        return;
      }

      const { chatId, data, user } = this.extractCallbackData(query);

      Logger.info(`🔄 Callback: ${data} от ${user.id}`);

      // Отвечаем на callback сразу, чтобы убрать "часики" в Telegram
      await this.bot.answerCallbackQuery(query.id);

      // Специальная обработка для admin_delete_ (регулярное выражение)
      if (this.isAdminDeleteCallback(data)) {
        await this.handleAdminDelete(data, chatId, user.id);
        return;
      }

      // Специальная обработка для broadcast_program_
      if (this.isBroadcastProgramCallback(data)) {
        await this.handleBroadcastProgram(data, chatId, user.id);
        return;
      }

      // Специальная обработка для admin_confirm_, admin_reject_, admin_call_
      if (this.isAdminActionCallback(data)) {
        await this.handleAdminAction(data, chatId, user.id, query);
        return;
      }

      // Поиск обработчика по префиксу
      for (const [prefix, handler] of this.handlers.entries()) {
        if (data.startsWith(prefix)) {
          await handler(data, query);
          Logger.success(`✅ Callback обработан за ${Date.now() - startTime}ms: ${data}`);
          return;
        }
      }

      // Если это admin_* callback, но не нашелся в специальных обработчиках
      if (data.startsWith(CALLBACK_PREFIXES.ADMIN)) {
        await this.handleAdminGeneric(data, chatId, user.id, query);
        return;
      }

      Logger.warn(`⚠️ Неизвестный callback: ${data}`);

    } catch (error) {
      this.handleError(error, query);
    }
  }

  private validateCallback(query: TelegramBot.CallbackQuery): boolean {
    if (!query.data || !query.message) {
      Logger.warn('⚠️ Callback без данных или сообщения');
      return false;
    }
    return true;
  }

  private extractCallbackData(query: TelegramBot.CallbackQuery) {
    return {
      chatId: query.message!.chat.id,
      data: query.data!,
      user: query.from
    };
  }

  private isAdminDeleteCallback(data: string): boolean {
    return /^admin_delete_\d+$/.test(data);
  }

  private isBroadcastProgramCallback(data: string): boolean {
    return data.startsWith(CALLBACK_PREFIXES.BROADCAST_PROGRAM);
  }

  private isAdminActionCallback(data: string): boolean {
    return data.startsWith(CALLBACK_PREFIXES.ADMIN_CONFIRM) ||
      data.startsWith(CALLBACK_PREFIXES.ADMIN_REJECT) ||
      data.startsWith(CALLBACK_PREFIXES.ADMIN_CALL);
  }

  private async handleUserGuide(data: string, chatId: number): Promise<void> {
    const guideId = parseInt(data.replace(CALLBACK_PREFIXES.GUIDE, ''));
    if (!isNaN(guideId)) {
      await this.startHandler.showGuide(chatId, guideId);
    }
  }

  private async handleSingleDate(data: string, chatId: number): Promise<void> {
    const sessionId = Number(data.replace(CALLBACK_PREFIXES.SINGLE_DATE, ''));
    await this.bookingHandler.selectSingleLessonDate(chatId, sessionId);
  }

  private async handleToggleFull(data: string, chatId: number): Promise<void> {
    const sessionId = Number(data.replace(CALLBACK_PREFIXES.TOGGLE_FULL, ''));
    await this.bookingHandler.toggleFullSession(chatId, sessionId);
  }

  private async handleOptionFull(data: string, query: TelegramBot.CallbackQuery): Promise<void> {
    const programId = Number(data.split('_')[2]);
    await this.bookingHandler.selectOpenGroupOption(
      query.message!.chat.id,
      'full',
      programId,
      query.from
    );
  }

  private async handleOption(data: string, query: TelegramBot.CallbackQuery): Promise<void> {
    const parts = data.split('_');
    const option = parts[1] as 'single' | 'full';
    const programId = Number(parts[2]);

    await this.bookingHandler.selectOpenGroupOption(
      query.message!.chat.id,
      option,
      programId,
      query.from
    );
  }

  private async handleBook(data: string, query: TelegramBot.CallbackQuery): Promise<void> {
    const programId = parseInt(data.replace(CALLBACK_PREFIXES.BOOK, ''));
    await this.bookingHandler.startBooking(query.message!.chat.id, programId, query.from);
  }

  private async handlePayment(data: string, chatId: number): Promise<void> {
    const method = data.replace(CALLBACK_PREFIXES.PAYMENT, '');
    await this.bookingHandler.handlePaymentMethod(chatId, method);
  }

  private async handleShowPhone(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `📞 <b>Телефон Анны:</b>\n${config.anna.phone}`,
      { parse_mode: 'HTML' }
    );
  }

  private async handleAdminDelete(data: string, chatId: number, userId: number): Promise<void> {
    const id = parseInt(data.replace(CALLBACK_PREFIXES.ADMIN_DELETE, ''));
    await this.adminHandler.deleteProgramById(chatId, id, userId);
  }

  private async handleBroadcastProgram(data: string, chatId: number, userId: number): Promise<void> {
    const programId = Number(data.replace(CALLBACK_PREFIXES.BROADCAST_PROGRAM, ''));
    await this.adminHandler.startBroadcastForProgram(chatId, programId, userId);
  }

  private async handleAdminAction(data: string, chatId: number, userId: number, query: TelegramBot.CallbackQuery): Promise<void> {
    if (data.startsWith(CALLBACK_PREFIXES.ADMIN_CONFIRM)) {
      const appId = parseInt(data.replace(CALLBACK_PREFIXES.ADMIN_CONFIRM, ''));
      if (!isNaN(appId)) {
        await this.adminHandler.confirmPayment(appId, userId);
      }
    } else if (data.startsWith(CALLBACK_PREFIXES.ADMIN_REJECT)) {
      const appId = parseInt(data.replace(CALLBACK_PREFIXES.ADMIN_REJECT, ''));
      if (!isNaN(appId)) {
        await this.adminHandler.rejectApplication(appId);
      }
    } else if (data.startsWith(CALLBACK_PREFIXES.ADMIN_CALL)) {
      const appId = parseInt(data.replace(CALLBACK_PREFIXES.ADMIN_CALL, ''));
      if (!isNaN(appId)) {
        await this.adminHandler.showApplicantContact(appId, userId);
      }
    }
  }

  private async handleAdminGeneric(data: string, chatId: number, userId: number, query: TelegramBot.CallbackQuery): Promise<void> {
    // Проверяем, может это add_* или другие общие паттерны
    if (data.startsWith('add_') ||
      data.startsWith('day_') ||
      data.startsWith('time_') ||
      data.startsWith('schedule_') ||
      data.startsWith('intensive_days_') ||
      data.startsWith('int_time_')) {
      await this.adminAddProgramHandler.handleCallback(chatId, data);
      return;
    }

    // Обработка основных admin команд
    switch (data) {
      case 'admin_panel':
        await this.adminHandler.showAdminPanel(chatId, userId);
        break;
      case 'admin_applications':
        await this.adminHandler.showApplications(chatId, userId);
        break;
      case 'admin_bookings':
        await this.adminHandler.showBookings(chatId, userId);
        break;
      case 'admin_stats':
        await this.adminHandler.showStats(chatId, userId);
        break;
      case 'admin_celebrate':
        await this.adminHandler.sendCelebration(userId);
        break;
      case 'admin_confirm_payment':
        await this.adminHandler.showApplications(chatId, userId);
        break;
      case 'admin_add_program':
        await this.adminAddProgramHandler.start(chatId);
        break;
      case 'admin_my_schedule':
        await this.adminHandler.showMySchedule(chatId, userId);
        break;
      case 'admin_activities':
        await this.adminHandler.showActivitiesMenu(chatId, userId);
        break;
      case 'admin_list_programs':
        await this.adminHandler.listPrograms(chatId, userId);
        break;
      case 'admin_delete_program':
        await this.adminHandler.deleteProgramMenu(chatId, userId);
        break;
      case 'admin_broadcast':
        await this.adminHandler.startBroadcast(chatId, userId);
        break;
      case 'admin_guides':
        await this.adminGuideHandler.showGuidesMenu(chatId, userId);
        break;
      case 'add_type_group':
        await this.adminAddProgramHandler.setType(chatId, 'group');
        break;
      case 'add_type_intensive':
        await this.adminAddProgramHandler.setType(chatId, 'intensive');
        break;
      case 'add_type_open_group':
        await this.adminAddProgramHandler.setType(chatId, 'open_group');
        break;
      case 'add_type_individual':
        await this.adminAddProgramHandler.setType(chatId, 'individual');
        break;
      case 'add_confirm':
        await this.adminAddProgramHandler.confirm(chatId);
        break;
      default:
        Logger.warn(`⚠️ Неизвестный admin callback: ${data}`);
    }
  }

  private async handleProgram(data: string, chatId: number): Promise<void> {
    const programTypeOrId = data.replace(CALLBACK_PREFIXES.PROGRAM, '');
    const programId = parseInt(programTypeOrId);

    if (!isNaN(programId)) {
      await this.programsHandler.showProgramDetails(chatId, programId);
    } else {
      await this.programsHandler.showProgramsByType(chatId, programTypeOrId);
    }
  }

  private async handleNavigation(chatId: number, data: string): Promise<void> {
    const action = data.replace(CALLBACK_PREFIXES.NAV, '');

    try {
      switch (action) {
        case 'info':
          await this.showInfoBlocks(chatId);
          break;
        case 'start':
          await this.showStartMenu(chatId);
          break;
        case 'prices':
        case 'studio':
        case 'contacts':
        case 'equipment':
          await this.startHandler.handleNavigation(chatId, action);
          break;
        case 'programs':
          await this.programsHandler.showPrograms(chatId);
          break;
        case 'guides':
          await this.startHandler.showGuidesList(chatId);
          break;
        case 'booking':
          await this.bot.sendMessage(chatId, 'Для записи выберите программу из списка:');
          await this.programsHandler.showPrograms(chatId);
          break;
        default:
          Logger.warn(`⚠️ Неизвестная навигация: ${action}`);
          await this.bot.sendMessage(chatId, 'Выберите действие:');
      }
    } catch (error) {
      Logger.error(`Ошибка навигации ${action}:`, error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при навигации');
    }
  }

  private async showStartMenu(chatId: number): Promise<void> {
    try {
      const keyboard = {
        inline_keyboard: [
          [{ text: '💃 Записаться', callback_data: 'nav_programs' }],
          [
            { text: '📅 Мои занятия', callback_data: 'nav_my_bookings' },
            { text: '🗓 Расписание студии', callback_data: 'nav_schedule' }
          ],
          [{ text: 'ℹ️ Информация', callback_data: 'nav_info' }],
        ]
      };

      await this.bot.sendMessage(chatId, 'Выберите действие', {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      Logger.success(`Главное меню показано для чата ${chatId}`);
    } catch (error) {
      Logger.error(`Ошибка показа главного меню для чата ${chatId}:`, error);
      await this.bot.sendMessage(
        chatId,
        '❌ Произошла ошибка. Попробуйте команду /start'
      );
    }
  }

  private async showInfoBlocks(chatId: number): Promise<void> {
    try {
      const infoMessage = `ℹ️ <b>Информация</b>\n\nВыберите раздел:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '📍 Студия', callback_data: 'nav_studio' }],
          [{ text: '📞 Контакты', callback_data: 'nav_contacts' }],
          [{ text: '👗 Что взять', callback_data: 'nav_equipment' }],
          [{ text: '📚 Гайды', callback_data: 'nav_guides' }],
          [{ text: '🏠 В начало', callback_data: 'nav_start' }]
        ]
      };

      await this.bot.sendMessage(chatId, infoMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      Logger.success(`Информационные блоки показаны для чата ${chatId}`);
    } catch (error) {
      Logger.error(`Ошибка показа информационных блоков для чата ${chatId}:`, error);
    }
  }

  private handleError(error: unknown, query: TelegramBot.CallbackQuery): void {
    Logger.error(`❌ Ошибка обработки callback ${query.data}:`, error);

    this.bot.answerCallbackQuery(query.id, {
      text: '❌ Произошла ошибка'
    }).catch(e => Logger.error('Ошибка при отправке ответа на callback:', e));
  }
}