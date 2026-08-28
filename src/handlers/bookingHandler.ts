import TelegramBot from 'node-telegram-bot-api';
import { ApplicationService } from '../database/services/ApplicationService';
import { ProgramService } from '../database/services/ProgramService';
import { UserService } from '../database/services/UserService';
import { NotificationService } from '../database/services/NotificationService';
import { formatCurrency, formatDate, formatSchedule } from '../utils/formatters';
import { BookingService } from '../database/services/BookingService';

// Простая система состояний в памяти (можно заменить на Redis)
interface BookingSession {
  chatId: number;
  programId: number;
  step: 'contact' | 'notes' | 'payment' | 'summary' | 'choose_date' | 'choose_dates_full';
  pickerMessageId?: number; // ✅ добавили
  data: {
    userId?: number;
    notes?: string;
    paymentMethod?: string;
    selectedOption?: 'single' | 'full';
    sessionId?: number;
    selectedSessions?: number[]; // ✅ выбранные занятия
    sessionIds?: number[];
  };
}

export class BookingHandler {
  private sessions = new Map<number, BookingSession>();
  private selectedFullSessions: Record<number, number[]> = {};

  constructor(
    private bot: TelegramBot,
    private applicationService: ApplicationService,
    private programService: ProgramService,
    private userService: UserService,
    private notificationService: NotificationService,
    private bookingService: BookingService 

  ) { }

  async startBooking(chatId: number, programId: number, user: TelegramBot.User): Promise<void> {
    this.sessions.delete(chatId);

    try {
      const program = await this.programService.getById(programId);
      if (!program) {
        await this.bot.sendMessage(chatId, '❌ Программа не найдена');
        return;
      }

      // ✅ ПРОВЕРКА 1: программа должна быть активной
      if (program.status === 'deleted' || program.status === 'inactive') {
        await this.bot.sendMessage(
          chatId,
          '⚠️ Эта программа уже завершена или неактивна.\n\n' +
          'Пожалуйста, выберите актуальное расписание из главного меню (/start).'
        );
        return;
      }

      // ✅ ПРОВЕРКА 2: пользователь ещё не записан на эту программу
      const dbUser = await this.userService.getOrCreate(user);

      // 🛡️ ЗАЩИТА ОТ NULL: если пользователя по какой-то причине не удалось получить/создать
      if (!dbUser) {
        console.error(`[Booking] Не удалось получить dbUser для telegram_id: ${user.id}`);
        await this.bot.sendMessage(
          chatId,
          '❌ Не удалось обработать ваш профиль. Попробуйте начать с команды /start или напишите Ане.'
        );
        return;
      }

      // Теперь TypeScript знает, что dbUser точно существует, и ошибка исчезнет
      const alreadyBooked = await this.bookingService.hasActiveBooking(dbUser.id, program.id);

      if (alreadyBooked) {
        await this.bot.sendMessage(
          chatId,
          `💫 Вы уже записаны на программу «${program.title}».\n\n` +
          `Проверить свои записи можно в разделе "📅 Мои занятия".\n` +
          `Если нужна другая программа — вернитесь в главное меню (/start).`
        );
        return;
      }

      if (program.type === 'individual') {
        await this.handleIndividualBooking(chatId, program, user);
        return;
      }

      const freeSpots = program.max_participants - program.current_participants;
      if (freeSpots <= 0) {
        await this.bot.sendMessage(
          chatId,
          '😔 Все места заняты. Вы можете записаться на другую программу'
        );
        return;
      }

      this.sessions.set(chatId, {
        chatId,
        programId,
        step: 'contact',
        data: {
          userId: user.id
        }
      });

      if (program.type === 'open_group' && program.single_price) {
        await this.showOpenGroupOptions(chatId, program, dbUser);
        return;
      }

      await this.askForContact(chatId, program, dbUser);
    } catch (error) {
      console.error('Start booking error:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при начале записи');
    }
  }

  // Handle option selection for open groups (callback from inline keyboard)
  async handleOpenGroupOption(chatId: number, option: 'single' | 'full', programId: number, user: TelegramBot.User): Promise<void> {
    try {
      const session = this.sessions.get(chatId);
      if (!session) {
        // If there's no session, initialize one so flow can continue
        this.sessions.set(chatId, {
          chatId,
          programId,
          step: 'contact',
          data: { selectedOption: option }
        });
      } else {
        session.data.selectedOption = option;
        session.data.userId = user.id;
        this.sessions.set(chatId, session);
      }

      // Ensure we have program and user in DB
      const program = await this.programService.getById(programId);
      if (!program) {
        await this.bot.sendMessage(chatId, '❌ Программа не найдена');
        return;
      }

      // Ensure user exists in DB (create if missing)
      const dbUser = await this.userService.getOrCreate(user);

      // Continue booking flow by asking for contact
      await this.askForContact(chatId, program, dbUser);
    } catch (error) {
      console.error('handleOpenGroupOption error:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при выборе варианта записи');
    }
  }

  private async showOpenGroupOptions(chatId: number, program: any, user: any): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    await this.bot.sendMessage(
      chatId,
      `🎪 <b>Открытая группа</b>\n\n` +
      `Выберите вариант участия:\n\n` +
      `1. <b>4 занятия (полный цикл)</b>\n` +
      `   • Стоимость: ${formatCurrency(program.price)}\n\n` +
      `2. <b>Разовое посещение</b>\n` +
      `   • Стоимость: ${formatCurrency(program.single_price)}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ 4 занятия', callback_data: `option_full_${program.id}` },
              { text: '🎫 Разовое', callback_data: `option_single_${program.id}` }
            ],
            [{ text: '❌ Отмена', callback_data: 'booking_cancel' }]
          ]
        }
      }
    );
  }

  private async askForContact(chatId: number, program: any, user: any): Promise<void> {
    // Determine display price (for open_group, respect selectedOption if present in session)
    const session = this.sessions.get(chatId);
    let displayPrice = program.price;
    if (program.type === 'open_group' && session && session.data.selectedOption === 'single' && program.single_price) {
      displayPrice = program.single_price;
    }

    const message = `📝 <b>Запись на программу</b>\n\n` +
      `<b>${program.title}</b>\n` +
      `💰 <b>Стоимость:</b> ${formatCurrency(displayPrice)}\n\n` +
      `👇 <b>Важно!</b> Пожалуйста, нажмите кнопку <b>"📱 Отправить номер"</b> ниже.\n` +
      `Если вы введете номер вручную, бот не сможет продолжить.\n\n` +
      `⚠️ <i>Нажимая «Отправить номер», вы соглашаетесь на обработку персональных данных.</i>`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '📱 Отправить номер', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  async handleContact(chatId: number, contact: TelegramBot.Contact, user: TelegramBot.User): Promise<void> {
    try {
      console.log(`📞 Получен контакт от ${user.id}: ${contact.phone_number}`);

      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'contact') return;

      // Обновляем телефон пользователя в БД
      const phoneUpdated = await this.userService.updatePhone(user.id, contact.phone_number);

      if (!phoneUpdated) {
        console.warn(`⚠️ Телефон не обновлен в БД, но продолжаем процесс`);
      } else {
        console.log(`✅ Телефон обновлен в БД для пользователя ${user.id}`);
      }

      // Небольшая задержка для синхронизации БД
      await new Promise(resolve => setTimeout(resolve, 500));

      // Переходим к следующему шагу
      session.data.userId = user.id;
      this.sessions.set(chatId, session);

      // Переходим к следующему шагу
      session.step = 'notes';
      session.data.userId = user.id;
      this.sessions.set(chatId, session);

      // Сразу спрашиваем заметки
      await this.bot.sendMessage(
        chatId,
        `📝 <b>Пара нюансов</b>\n\n` +
        `Будет круто, если напишешь:\n` +
        `🩹 травмы или ограничения\n` +
        `🎯 цель на занятие\n\n` +
        `👇 это не обязательно, но очень помогает 💛`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Нет, всё отлично', callback_data: 'notes_skip' }]
            ]
          }

        }
      );


    } catch (error) {
      console.error('Contact error:', error);

      // Даже при ошибке продолжаем процесс
      const session = this.sessions.get(chatId);
      if (session) {
        session.data.userId = user.id;
        this.sessions.set(chatId, session);

      }
    }
  }

  async handleMessage(chatId: number, text: string, user?: TelegramBot.User): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session || !user) return;

    switch (session.step) {
      case 'notes':
        await this.handleNotes(chatId, text);
        break;

      case "choose_date":
        await this.handleSingleLessonDate(chatId, text);
        break;

    }
  }

  async handleNotes(chatId: number, notes: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.data.notes = notes === 'нет' ? '' : notes;
    session.step = 'payment';
    this.sessions.set(chatId, session);

    await this.askPaymentMethod(chatId);
  }

  private async askPaymentMethod(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `💳 <b>Как оплатить занятие</b>\n\n` +
      `Оплатить можно <b>любым удобным способом</b> — переводом по реквизитам ниже 👇\n\n` +
      `<b>Получатель:</b>\n` +
      `Анна Карелина\n\n` +
      `<b>Способы оплаты:</b>\n` +
      `📞 <b>По номеру телефона:</b> +7 915 673-28-91 (на ТБанк)\n\n` +
      `Ваша заявка автоматически попадёт к Ане — она проверит оплату и подтвердит запись.\n\n` +
      `⏳ Обычно подтверждение занимает до <b>24 часов</b>.\n\n` +
      `Когда будете готовы — нажмите кнопку ниже 👇`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Я оплатил(а)', callback_data: 'booking_confirm' }],
            [{ text: '❌ Отменить запись', callback_data: 'booking_cancel' }]
          ]
        }
      }
    );
  }


  async handlePaymentMethod(chatId: number, method: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.data.paymentMethod = method;
    session.step = 'summary';
    this.sessions.set(chatId, session);

    console.log(`📊 Данные сессии перед сводкой:`, {
      chatId,
      step: session.step,
      userId: session.data.userId,
      paymentMethod: session.data.paymentMethod
    });

    await this.showSummary(chatId);
  }

  private async showSummary(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    try {
      const program = await this.programService.getById(session.programId);
      if (!program) return;

      // ПОЛУЧАЕМ АКТУАЛЬНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ИЗ БАЗЫ
      const user = await this.userService.getByTelegramId(session.data.userId || chatId);

      if (!user) {
        console.error(`❌ Пользователь не найден для чата ${chatId}`);
        await this.bot.sendMessage(chatId, '❌ Ошибка: пользователь не найден');
        return;
      }

      console.log(`📊 Данные пользователя для сводки:`, {
        id: user.id,
        name: `${user.first_name} ${user.last_name || ''}`,
        phone: user.phone,
        telegramId: user.telegram_id
      });

      const paymentMethods: Record<string, string> = {
        'tinkoff': 'Тинькофф',
      };

      // Определяем сумму
      let amount = program.price;
      if (program.type === 'open_group') {
        amount = session.data.selectedOption === 'single'
          ? (program.single_price || program.price)
          : program.price;
      }

      const message = `📋 <b>Проверьте данные заявки:</b>\n\n` +
        `<b>Программа:</b> ${program.title}\n` +
        (program.type === 'open_group' && session.data.selectedOption
          ? `<b>Вариант:</b> ${session.data.selectedOption === 'single' ? 'Разовое' : '4 занятия'}\n`
          : '') +
        `<b>Имя:</b> ${user.first_name || ''} ${user.last_name || ''}\n` +
        `<b>Телефон:</b> ${user.phone || '<i>не указан</i>'}\n` +
        `<b>Способ оплаты:</b> ${paymentMethods[session.data.paymentMethod || ''] || 'не выбран'}\n` +
        `<b>Заметки:</b> ${session.data.notes || 'нет'}\n` +
        `<b>Сумма:</b> ${formatCurrency(amount)}\n\n` +
        `<b>Всё верно?</b>`;

      console.log(`📨 Отправка сводки пользователю ${chatId}:`, message);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Да, отправить', callback_data: 'booking_confirm' },
              { text: '❌ Нет, отменить', callback_data: 'booking_cancel' }
            ]
          ]
        }
      });

    } catch (error) {
      console.error('Ошибка показа сводки:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при формировании сводки');
    }
  }

  async confirmBooking(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    try {
      const program = await this.programService.getById(session.programId);
      const user = await this.userService.getByTelegramId(session.data.userId || 0);
      if (!session.data.userId) {
        throw new Error("UserId missing in session");
      }
      if (!program || !user) {
        throw new Error('Program or user not found');
      }
      if (!user.phone) {
        session.step = "contact";
        await this.askForContact(chatId, program, user);
        return;
      }

      // Определяем сумму
      let amount = program.price;
      if (program.type === 'open_group') {
        amount = session.data.selectedOption === 'single'
          ? (program.single_price || program.price)
          : program.price;
      }

      // Создаем заявку
      const application = await this.applicationService.create({
        program_id: program.id,
        user_id: user.id,
        user_name: `${user.first_name}`.trim(),
        user_phone: user.phone || "",
        payment_method: session.data.paymentMethod,
        user_notes: session.data.notes,
        // если full → session_id не нужен
        session_id: session.data.selectedOption === "single"
          ? session.data.sessionId
          : null,
        session_ids: session.data.selectedSessions || null,
        amount,
        status: "pending"
      });

      if (!application) {
        throw new Error('Failed to create application');
      }

      // Отправляем уведомление Ане
      await this.notificationService.sendNewApplication(application, {
        programTitle: program.title,
        userName: user.first_name || '',
        telegramUsername: user.username,
        phone: user.phone
      });

      // Удаляем сессию
      this.sessions.delete(chatId);
      await this.removeKeyboard(chatId); // ← добавляем

      // Отправляем подтверждение пользователю
      await this.sendConfirmation(chatId, program, application.id);
    } catch (error) {
      console.error('Confirm booking error:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при создании заявки');
    }
  }

  private async sendConfirmation(chatId: number, program: any, applicationId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `🎉 <b>Заявка отправлена!</b>\n\n` +
      `<b>Программа:</b> ${program.title}\n` +
      `<b>ID заявки:</b> ${applicationId}\n\n` +
      `<b>Что дальше:</b>\n` +
      `1. Аня проверит вашу заявку\n` +
      `2. Подтвердит оплату\n` +
      `3. Отправит подтверждение записи\n\n` +
      `<b>Обычно это занимает до 24 часов.</b>\n\n` +
      `<b>Контакты для вопросов:</b>\n` +
      `📱 Telegram: @anv_karelina\n` +
      `📞 Телефон: +79156732891`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '💬 Написать Ане', url: 'https://t.me/anv_karelina' },
            { text: '🏠 В начало', callback_data: 'nav_start' }
          ]]
        }
      }
    );
  }

  async cancelBooking(chatId: number): Promise<void> {
    this.sessions.delete(chatId);
    await this.removeKeyboard(chatId); // ← добавляем

    await this.bot.sendMessage(
      chatId,
      '❌ Запись отменена\n\n' +
      'Если передумаете — всегда можно начать заново! 💫',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '💃 Посмотреть программы', callback_data: 'nav_programs' },
            { text: '🏠 В начало', callback_data: 'nav_start' }
          ]]
        }
      }
    );
  }


  async selectOpenGroupOption(
    chatId: number,
    option: "single" | "full",
    programId: number,
    user: TelegramBot.User
  ) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.data.selectedOption = option;

    const program = await this.programService.getById(programId);
    if (!program) return;

    // 🎫 Разовое занятие → спрашиваем дату
    if (option === "single") {
      session.step = "choose_date";
      this.sessions.set(chatId, session);

      await this.askSingleLessonDate(chatId, program);
      return;
    }
    if (option === "full") {
      session.step = "choose_dates_full";
      this.sessions.set(chatId, session);

      // запускаем новый picker
      await this.showFullDatesPicker(chatId, programId);
      return;
    }



    // 📦 Курс → продолжаем как обычно
    session.step = "contact";
    this.sessions.set(chatId, session);

    await this.askForContact(chatId, program, user);
  }

  private async askSingleLessonDate(chatId: number, program: any) {
    let sessions = await this.programService.getSessions(program.id);

    if (!sessions.length) {
      await this.bot.sendMessage(
        chatId,
        "⚠️ Для этой группы пока не заведены даты занятий."
      );
      return;
    }

    // ================================
    // ✅ 1) фильтр: только текущий месяц программы
    // ================================
    const start = new Date(program.start_date);

    const programMonth = start.getMonth(); // 0-11
    const programYear = start.getFullYear();

    sessions = sessions.filter((s: any) => {
      const d = new Date(s.session_date);
      return (
        d.getMonth() === programMonth &&
        d.getFullYear() === programYear
      );
    });

    // ================================
    // ✅ 2) фильтр: только будущие даты
    // ================================
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    sessions = sessions.filter((s: any) => {
      const d = new Date(s.session_date);
      return d >= today;
    });

    // если после фильтра ничего не осталось
    if (!sessions.length) {
      await this.bot.sendMessage(
        chatId,
        "⚠️ В этом месяце больше нет доступных занятий."
      );
      return;
    }

    // ================================
    // ✅ 3) красивый формат кнопок
    // ================================
    const keyboard = sessions.map((s: any) => {
      const dateObj = new Date(s.session_date);

      const prettyDate = dateObj.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "long"
      });

      const weekday = dateObj.toLocaleDateString("ru-RU", {
        weekday: "short"
      });

      return [
        {
          text: `📅 ${prettyDate} (${weekday}) — ${s.session_time}`,
          callback_data: `single_date_${s.id}` // ✅ важно
        }
      ];
    });


    keyboard.push([{ text: "❌ Отмена", callback_data: "booking_cancel" }]);

    // ================================
    // ✅ отправляем сообщение
    // ================================
    await this.bot.sendMessage(
      chatId,
      `🎫 <b>Разовое занятие</b>\n\nВыберите дату занятия:`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      }
    );
  }


  async handleSingleLessonDate(chatId: number, text: string) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const regex = /^\d{4}-\d{2}-\d{2}$/;

    if (!regex.test(text)) {
      await this.bot.sendMessage(
        chatId,
        "❌ Неверный формат даты.\nВведите так: 2026-02-10"
      );
      return;
    }

    // сохраняем дату как заметку
    session.data.notes = `Разовое занятие на дату: ${text}`;

    // продолжаем стандартный поток
    session.step = "contact";
    this.sessions.set(chatId, session);

    const program = await this.programService.getById(session.programId);
    if (!program) return;

    await this.askForContact(chatId, program, {} as any);
  }


  async selectSingleLessonDate(chatId: number, sessionId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.data.sessionId = sessionId;

    const count = await this.bookingService.countParticipantsForSession(sessionId);

    if (count >= 10) {
      await this.bot.sendMessage(
        chatId,
        "😔 На эту дату уже нет мест (10 человек).\nВыберите другую."
      );
      return;
    }

    // достаём тренировку из базы
    const programSessions = await this.programService.getSessions(session.programId);

    const chosen = programSessions.find((s: any) => s.id === sessionId);
    if (!chosen) {
      await this.bot.sendMessage(chatId, "❌ Не удалось найти занятие");
      return;
    }

    // ✅ сохраняем session_id

    // сохраняем красивую заметку
    session.data.notes =
      `Разовое занятие: ${chosen.session_date} (${chosen.session_time})`;

    // дальше спрашиваем пожелания
    session.step = "notes";
    this.sessions.set(chatId, session);

    await this.bot.sendMessage(
      chatId,
      "📝 Есть ли дополнительные пожелания?\n\nНапишите текстом или нажмите кнопку 👇",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Нет, всё отлично", callback_data: "notes_skip" }]
          ]
        }
      }
    );
  }
  

  private async showFullDatesPicker(chatId: number, programId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const sessions = await this.programService.getSessions(programId);

    session.data.selectedSessions ||= [];
    const selected = session.data.selectedSessions;

    let text = `📅 <b>Выберите ровно 4 занятия:</b>\n\n`;

    const keyboard = sessions.map((s: any) => {
      const isSelected = selected.includes(s.id);

      return [
        {
          text: `${isSelected ? "✅" : "⬜"} ${formatDate(s.session_date)} — ${s.session_time}`,
          callback_data: `toggle_full_${s.id}`
        }
      ];
    });

    text += `\nВыбрано: <b>${selected.length}/4</b>\n`;

    if (selected.length === 4) {
      keyboard.push([
        { text: "➡️ Продолжить", callback_data: "full_done" }
      ]);
    }

    keyboard.push([{ text: "❌ Отмена", callback_data: "booking_cancel" }]);

    // ✅ Если сообщение уже есть → редактируем
    if (session.pickerMessageId) {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: session.pickerMessageId,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    // ✅ Если ещё нет → отправляем первое сообщение
    else {
      const sent = await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });

      session.pickerMessageId = sent.message_id;
      this.sessions.set(chatId, session);
    }
  }



  async toggleFullSession(chatId: number, sessionId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.data.selectedSessions ||= [];
    let selected = session.data.selectedSessions;

    if (selected.includes(sessionId)) {
      selected = selected.filter(id => id !== sessionId);
    } else {
      if (selected.length >= 4) {
        await this.bot.answerCallbackQuery(chatId.toString(), {
          text: "Можно выбрать только 4 занятия"
        });
        return;
      }
      selected.push(sessionId);
    }

    session.data.selectedSessions = selected;
    this.sessions.set(chatId, session);

    // ✅ просто обновляем сообщение
    await this.showFullDatesPicker(chatId, session.programId);
  }

  async finishFullBooking(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    if (!session.data.selectedSessions || session.data.selectedSessions.length !== 4) {
      await this.bot.sendMessage(chatId, "⚠️ Нужно выбрать ровно 4 занятия.");
      return;
    }

    // ✅ убираем picker-сообщение
    if (session.pickerMessageId) {
      await this.bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: session.pickerMessageId
        }
      );
    }

    session.step = "notes";
    this.sessions.set(chatId, session);

    await this.bot.sendMessage(
      chatId,
      "📝 Есть ли дополнительные пожелания?\n\nНапишите текстом или нажмите кнопку 👇",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Нет, всё отлично", callback_data: "notes_skip" }]
          ]
        }
      }
    );
  }

  private async handleIndividualBooking(chatId: number, program: any, user: TelegramBot.User) {
    // Получаем сессии из БД
    const sessions = await this.programService.getSessions(program.id);

    let scheduleText = '🗓️ *Расписание уточняется*\nНапиши Ане, чтобы согласовать удобное время 💫';

    if (sessions && sessions.length > 0) {
      // Фильтруем только будущие сессии
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const futureSessions = sessions.filter((session: any) => {
        const sessionDate = new Date(session.session_date);
        return sessionDate >= today;
      });

      if (futureSessions.length > 0) {
        // Сортируем по дате
        futureSessions.sort((a: any, b: any) =>
          new Date(a.session_date).getTime() - new Date(b.session_date).getTime()
        );

        // Форматируем даты красиво
        const formattedSessions = futureSessions.map((session: any) => {
          const date = new Date(session.session_date);

          // Формат: "9 февраля Пн 15:00–16:30"
          const day = date.getDate();
          const month = date.toLocaleDateString('ru-RU', { month: 'long' });
          const weekday = date.toLocaleDateString('ru-RU', { weekday: 'short' });

          return `• ${day} ${month} ${weekday} ${session.session_time}`;
        }).join('\n');

        scheduleText = formattedSessions;
      }
    } else if (program.schedule) {
      // Если нет конкретных сессий, используем общее расписание
      scheduleText = `*Общее расписание:*\n${formatSchedule(program.schedule)}`;
    }

    await this.bot.sendMessage(
      chatId,
      `👤 <b>Индивидуальное занятие с Аней</b>\n\n` +
      `✨ <i>Персональные тренировки требуют обсуждения деталей</i>\n\n` +
      `📅 <b>Свободные слоты:</b>\n` +
      `${scheduleText}\n\n` +
      `💬 <b>Что обсудим с Аней:</b>\n` +
      `• Удобные день и время\n` +
      `• Твои цели в танцах\n` +
      `• Предпочитаемый стиль\n` +
      `• Длительность занятия\n\n` +
      `💰 <b>Стоимость:</b> ${formatCurrency(program.price)}\n\n` +
      `👇 <b>Нажми кнопку, чтобы написать Ане:</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💬 Написать Ане',
                url: 'https://t.me/anv_karelina'
              }
            ],
            [
              {
                text: '📅 Обновить расписание',
                callback_data: `program_${program.id}`
              },
              {
                text: '💃 Другие занятия',
                callback_data: 'nav_programs'
              }
            ]
          ]
        }
      }
    );
  }

  private async removeKeyboard(chatId: number): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, '⏳', { reply_markup: { remove_keyboard: true } });
    } catch (error) {
      console.error('Ошибка удаления клавиатуры:', error);
    }
  }

  async resetSession(chatId: number): Promise<void> {
    this.sessions.delete(chatId);
    await this.removeKeyboard(chatId);
  }

}




