import TelegramBot from 'node-telegram-bot-api';
import { AdminService } from '../database/services/AdminService';
import { ApplicationService } from '../database/services/ApplicationService';
import { BookingService } from '../database/services/BookingService';
import { ProgramService } from '../database/services/ProgramService';
import { formatApplication, formatBooking, formatCurrency, formatDate } from '../utils/formatters';
import { config } from '../config';
import { generateAdminKeyboard } from '../utils/keyboards';
import { supabase } from "../database/supabase";

export class AdminHandler {

  private broadcastMode = false;
  private broadcastText: string | null = null;
  private broadcastSegment: string = 'all';

  constructor(
    private bot: TelegramBot,
    private adminService: AdminService,
    private applicationService: ApplicationService,
    private bookingService: BookingService,
    private programService: ProgramService
  ) { }

  isInBroadcastMode(): boolean {
    return this.broadcastMode;
  }

  private async checkAccess(chatId: number, userId?: number): Promise<boolean> {
    if (!userId) {
      await this.bot.sendMessage(chatId, '❌ Пользователь не найден');
      return false;
    }

    const isAdmin = await this.adminService.isAdmin(userId);
    if (!isAdmin) {
      await this.bot.sendMessage(chatId, '⛔ Нет доступа к админ-панели');
      return false;
    }

    return true;
  }

  async showAdminPanel(chatId: number, userId?: number): Promise<void> {
    if (!await this.checkAccess(chatId, userId)) return;

    await this.bot.sendMessage(
      chatId,
      '👑 <b>Панель администратора</b>\n\n Выбери действие:',
      {
        parse_mode: 'HTML',
        reply_markup: generateAdminKeyboard()
      }
    );
  }

  async showApplications(chatId: number, userId?: number): Promise<void> {
    if (!await this.checkAccess(chatId, userId)) return;

    try {
      const applications = await this.applicationService.getPending();

      if (applications.length === 0) {
        await this.bot.sendMessage(chatId, '📭 Нет заявок, ожидающих обработки', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: "🏡 В админку", callback_data: "admin_panel" },
            ]]
          }
        });
        return;
      }

      // Отправляем заголовок с количеством заявок
      const header = `📋 <b>Заявки на рассмотрении (${applications.length})</b>`;
      // await this.bot.sendMessage(chatId, header, {
      //   parse_mode: 'HTML',
      //   reply_markup: {
      //     inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'admin_applications' }]]
      //   }
      // });

      // Для каждой заявки отправляем отдельное сообщение с кнопками Подтвердить/Отклонить
      for (const app of applications) {
        const text = await formatApplication(app);
        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Подтвердить', callback_data: `admin_confirm_${app.id}` },
              { text: '❌ Отклонить', callback_data: `admin_reject_${app.id}` }
            ],
            [
              { text: '🔄 Обновить список', callback_data: 'admin_applications' },
              { text: '📊 Статистика', callback_data: 'admin_stats' }
            ]
          ]
        };

        await this.bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error('Error showing applications:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки заявок');
    }
  }

  async showBookings(chatId: number, userId?: number): Promise<void> {
    if (!await this.checkAccess(chatId, userId)) return;

    try {
      const bookings = await this.bookingService.getAll();
      const activeBookings = bookings.filter(b => b.programs?.status === 'active');

      if (!activeBookings.length) {
        await this.bot.sendMessage(chatId, "📭 Нет подтвержденных записей");
        return;
      }

      // ================================
      // Группируем по типу программы
      // ================================
      const groupedByType: Record<string, any[]> = {};

      bookings.forEach((booking) => {
        const program = booking.programs; // ✅ объект, НЕ массив
        const type = program?.type;

        if (!groupedByType[type]) {
          groupedByType[type] = [];
        }

        groupedByType[type].push(booking);
      });

      // ================================
      // Подписи типов
      // ================================
      const typeLabels: Record<string, string> = {
        group: "👥 ГРУППОВЫЕ ЗАНЯТИЯ",
        individual: "👤 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ",
        open_group: "🚪 ОТКРЫТЫЕ ГРУППЫ",
        intensive: "🔥 ИНТЕНСИВЫ",
      };

      const typeOrder = ["group", "individual", "open_group", "intensive"];

      let message = `📅 <b>Подтвержденные записи (${bookings.length})</b>\n\n`;

      // ================================
      // Выводим по типам
      // ================================
      for (const type of typeOrder) {
        if (!groupedByType[type]) continue;

        const typeBookings = groupedByType[type];
        message += `──────────────\n\n`;
        message += `<b>${typeLabels[type]}</b>\n\n`;

        // ================================
        // Группируем внутри типа по программе
        // ================================
        const groupedByProgram: Record<string, any[]> = {};

        typeBookings.forEach((booking) => {
          const title = booking.programs?.title || "Без названия";

          if (!groupedByProgram[title]) {
            groupedByProgram[title] = [];
          }

          groupedByProgram[title].push(booking);
        });

        // ================================
        // Выводим каждую программу
        // ================================
        for (const [programTitle, programBookings] of Object.entries(groupedByProgram)) {

          message += `💃 <b>${programTitle}</b>\n`;

          for (let i = 0; i < programBookings.length; i++) {
            const booking = programBookings[i];
            const program = booking.programs;

            const user = booking.users;

            const fullName =
              user
                ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                : booking.user_name;

            const username =
              user?.username ? `@${user.username}` : "ник не указан";
            const price = formatCurrency(booking.amount || 0);

            let dateText = ['group', 'intensive'].includes(program?.type) ? `По расписанию: ${program?.schedule || 'уточняется'}` : "Абонемент / полный курс";
            // ============================================
            // 🎫 Разовая открытая группа → дата занятия
            // ============================================
            if (
              program?.type === "open_group" &&
              program?.single_price &&
              Number(booking.amount) === Number(program.single_price)
            ) {
              if (booking.session_id) {
                const { data: session } = await supabase
                  .from("program_sessions")
                  .select("session_date")
                  .eq("id", booking.session_id)
                  .single();

                dateText = session
                  ? formatDate(session.session_date)
                  : "Дата занятия не найдена";
              } else {
                dateText = "⚠️ session_id не сохранён";
              }
            }
            const payStatus =
              booking.payment_status === "paid"
                ? "✅ оплачено"
                : "⏳ не оплачено";



            message += `${i + 1}. <b>${fullName}</b> (${username}) [#${booking.id}]\n`;
            message += `   💰 ${price}\n`;
            message += `   ${payStatus}\n`;
            message += `   📅 ${dateText}\n\n`;
          }

          message += `──────────────\n\n`;
        }
      }

      // ================================
      // Отправляем сообщение
      // ================================
      await this.bot.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📊 Статистика", callback_data: "admin_stats" },
              { text: "🏡 В админку", callback_data: "admin_panel" },
            ],
          ],
        },
      });

    } catch (error) {
      console.error("Error showing bookings:", error);
      await this.bot.sendMessage(chatId, "❌ Ошибка загрузки записей");
    }
  }



  
  async showStats(chatId: number, userId?: number): Promise<void> {
    if (!await this.checkAccess(chatId, userId)) return;

    try {
      const appStats = await this.applicationService.getStats();
      const bookingStats = await this.bookingService.getStats();
      let message = `📊 <b>Статистика</b>\n\n` +
        `<b>Заявки:</b>\n` +
        `• Всего: ${appStats.total}\n` +
        `• Ожидают: ${appStats.pending}\n` +
        `• Одобрены: ${appStats.approved}\n` +
        `• Оплачены: ${appStats.paid}\n` +
        (appStats.rejected ? `• Отклонены: ${appStats.rejected}\n` : '') +
        `• Сумма: ${formatCurrency(appStats.totalAmount)}\n\n` +
        `<b>Записи:</b>\n` +
        `• Всего: ${bookingStats.total}\n` +
        `• Сумма: ${formatCurrency(bookingStats.totalAmount)}\n\n`;

      // Include breakdown by program type if present
      const byType = bookingStats.byType || {} as any;
      const lines: string[] = [];
      if (byType.group && byType.group > 0) lines.push(`• групповые занятия: ${formatCurrency(byType.group)}`);
      if (byType.individual && byType.individual > 0) lines.push(`• индивидуальные занятия: ${formatCurrency(byType.individual)}`);
      if (byType.open_single && byType.open_single > 0) lines.push(`• открытая группа (разово): ${formatCurrency(byType.open_single)}`);
      if (byType.open_full && byType.open_full > 0) lines.push(`• открытая группа (полный цикл): ${formatCurrency(byType.open_full)}`);
      if (byType.intensive && byType.intensive > 0) lines.push(`• интенсивы: ${formatCurrency(byType.intensive)}`);

      if (lines.length > 0) {
        message += `<b>Из них:</b>\n` + lines.join('\n');
      }

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: "🏡 В админку", callback_data: "admin_panel" },
            { text: '🎉', callback_data: 'admin_celebrate' }
          ]]
        }
      });
    } catch (error) {
      console.error('Error showing stats:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  // Отправляет смайлик аплодисментов в чат Ани и уведомляет админа
  async sendCelebration(requesterId?: number): Promise<void> {
    try {
      const annaId = Number(config.annaTelegramId);

      if (isNaN(annaId)) {
        if (requesterId)
          await this.bot.sendMessage(requesterId, '⚠️ ID Ани не настроен');
        return;
      }

      // 👏 Отправляем аплодисменты Ане
      await this.bot.sendMessage(annaId, '👏');

      // 🎲 Список мотивационных фраз
      const phrases = [
        "Ну всё, пошла жара 🔥",
        "Это успех, я считаю 😎",
        "Деньги есть — можно жить 💸",
        "Опа, бизнес пошёл 📈",
        "Шикарно, просто шикарно 💅",
        "Ну это уже уровень 🤝",
        "Жопы крутятся, лавэта мутится 💵",
        "Я в моменте 😌",
        "Сильнейшая 💃",
        "Легенда на месте 👑",
        "Пошёл движ, пошёл процесс 🔥",
        "Ну всё, теперь официально богиня бизнеса 😎",
        "Уважаем, ценим, любим ❤️",
        "Суету навела конкретную 💃",
        "Нормально так, нормально 😏",
        "ЭТО ПРЯМ ЖЁСТКО 💥",
        "Мощно. Очень мощно 🤝",
        "Сейчас бы так всегда 💸",
        "Ничего себе, вот это да 😳",
        "Аня, остановись… хотя нет, не останавливайся 😄",
        "Вот это поворот событий 🎬",
        "Это база ✅",
        "Всё чётко, всё по красоте 😎",
        "Ну всё, пошли миллионы 😂",
        "Главное — без паники, мы богаты 💵",
        "Деньги есть — можно и потанцевать 😂",
        "Ща как поднимемся 📈",
        "Ну всё, пошли миллионы 😂",
        "i am siiiiiiinging a song 🎤",
        "как дела это новый кадиллак 🚘",
        "Пу-пу-пу 🙈",
      ];


      // 🎲 Случайная фраза
      const randomPhrase =
        phrases[Math.floor(Math.random() * phrases.length)];

      // 💬 Отправляем админу поддержку
      if (requesterId) {
        await this.bot.sendMessage(requesterId, randomPhrase, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏡 В админку', callback_data: 'admin_panel' }]
            ]
          }
        });
      }
    } catch (error) {
      console.error('Error sending celebration to Anna:', error);

      if (requesterId)
        await this.bot.sendMessage(requesterId, '❌ Не удалось отправить сообщение Ане');
    }
  }

  async approveApplication(applicationId: number, userId?: number): Promise<void> {
    try {
      const application = await this.applicationService.getById(applicationId);
      if (!application) return;

      // Обновляем статус заявки
      await this.applicationService.updateStatus(applicationId, 'approved');

      // Создаем запись
      const booking = await this.bookingService.createFromApplication(application);

      // Обновляем счетчик участников
      if (booking) {
        await this.programService.incrementParticipants(application.program_id);
      }

      // TODO: Отправить уведомление пользователю
    } catch (error) {
      console.error('Error approving application:', error);
    }
  }

  async rejectApplication(applicationId: number, reason?: string): Promise<void> {
    try {
      // Получаем данные заявки до обновления (чтобы знать, кому отправлять)
      const application = await this.applicationService.getById(applicationId);

      if (!application) {
        console.error(`❌ Заявка ${applicationId} не найдена при отклонении`);
        return;
      }

      // Обновляем статус заявки
      await this.applicationService.updateStatus(applicationId, 'rejected', reason);

      // Отправляем уведомление пользователю, если есть telegram_id
      if (application.users?.telegram_id) {
        const programTitle = application.programs?.title || 'Занятие';

        let message = `😔 <b>Заявка отклонена</b>\n\n` +
          `💃 <b>${programTitle}</b>\n` +
          `❌ К сожалению, ваша заявка была отклонена.\n\n`;

        if (reason) {
          message += `📝 <b>Причина:</b> ${reason}\n\n`;
        }

        message += `💛 Если у вас есть вопросы, вы можете связаться с Аней напрямую.`;

        await this.bot.sendMessage(application.users.telegram_id, message, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💬 Написать Ане', url: 'https://t.me/anv_karelina' }],
              [{ text: '💃 Другие занятия', callback_data: 'nav_programs' }]
            ]
          }
        });

        console.log(`✅ Уведомление об отклонении отправлено пользователю ${application.users.telegram_id}`);
      }

    } catch (error) {
      console.error('Error rejecting application:', error);
    }
  }

  // Показывает контактные данные заявителя администратору
  async showApplicantContact(applicationId: number, adminId?: number): Promise<void> {
    try {
      const app = await this.applicationService.getById(applicationId);
      if (!app) {
        if (adminId) await this.bot.sendMessage(adminId, '❌ Заявка не найдена');
        return;
      }

      const phone = app.user_phone || 'не указан';
      const username = app.users && (app.users as any).telegram_username ? `@${(app.users as any).telegram_username}` : (app.users && (app.users as any).username) || 'не указан';

      const text = `📞 Контакт заявителя:\n` +
        `• Телефон: ${phone}\n` +
        `• Telegram: ${username}`;

      if (adminId) {
        await this.bot.sendMessage(adminId, text);
      }
    } catch (error) {
      console.error('Error showing applicant contact:', error);
      if (adminId) await this.bot.sendMessage(adminId, '❌ Не удалось получить контактные данные');
    }
  }



  async confirmPayment(applicationId: number, userId: number): Promise<void> {
    try {
      console.log(
        `🔔 Admin confirmPayment called: applicationId=${applicationId}, by admin=${userId}`
      );

      // ==========================================
      // 1) Загружаем заявку
      // ==========================================
      let application = await this.applicationService.getById(applicationId);

      if (!application) {
        await this.bot.sendMessage(userId, `❌ Заявка #${applicationId} не найдена`);
        return;
      }

      // ==========================================
      // 2) Обновляем статус заявки → paid
      // ==========================================
      await this.applicationService.updateStatus(applicationId, "paid");

      const updatedApp = await this.applicationService.getById(applicationId);

      if (!updatedApp || updatedApp.status !== "paid") {
        await this.bot.sendMessage(
          userId,
          `❌ Не удалось подтвердить оплату для заявки #${applicationId}`
        );
        return;
      }

      // ==========================================
      // 3) Создаём booking
      // ==========================================
      let booking;

      try {
        booking = await this.bookingService.createFromApplication(updatedApp as any);

        // ставим confirmed + paid
        // await supabase
        //   .from("bookings")
        //   .update({
        //     status: "confirmed",
        //     payment_status: "paid",
        //   })
        //   .eq("id", booking.id);

      } catch (e: any) {
        if (e?.message === "duplicate_booking") {
          await this.bot.sendMessage(
            userId,
            `⚠️ У пользователя уже есть подтверждённая запись на эту программу.`
          );
          return;
        }

        throw e;
      }

      if (!booking) {
        await this.bot.sendMessage(
          userId,
          `❌ Не удалось создать запись для заявки #${applicationId}`
        );
        return;
      }

      console.log("✅ Booking created:", booking);


      // ==========================================
      // 5) Берём ближайшее занятие из sessions
      // ==========================================
    //   let nextSession: any = null;

    //   if (booking.session_id) {
    //     // 🎫 Разовое занятие
    //     const { data } = await supabase
    //       .from("program_sessions")
    //       .select("session_date, session_time")
    //       .eq("id", booking.session_id)
    //       .single();

    //     nextSession = data;

    //   } else {
    //       // 📦 Абонемент → берём ближайшую дату из application_sessions (ещё до booking_sessions)

    //       const { data } = await supabase
    //         .from("application_sessions")
    //         .select(`
    //   program_sessions(session_date, session_time)
    // `)
    //         .eq("application_id", updatedApp.id)
    //         .order("program_sessions.session_date", { ascending: true })
    //         .limit(1)
    //         .single();

    //       nextSession = data?.program_sessions;
    //     }

      // Определяем ближайшее занятие в зависимости от типа программы
      let nextSession: any = null;
      const program = updatedApp.programs;

      if (!program) {
        // Программа не найдена — оставляем "уточняется"
      }
      // 🎫 Разовое занятие в открытой группе
      else if (booking.session_id) {
        const { data } = await supabase
          .from("program_sessions")
          .select("session_date, session_time")
          .eq("id", booking.session_id)
          .single();
        nextSession = data;
      }
      // 📦 Абонемент на открытую группу — первая выбранная сессия
      else if (program.type === 'open_group' && booking.id) {
        const { data } = await supabase
          .from("booking_sessions")
          .select(`
      program_sessions(session_date, session_time)
    `)
          .eq("booking_id", booking.id)
          .order("program_sessions.session_date", { ascending: true })
          .limit(1)
          .single();
        nextSession = data?.program_sessions;
      }
      // 👥 Групповые занятия и интенсивы — ближайшая сессия из расписания программы
      else if (['group', 'intensive'].includes(program.type)) {
        const { data } = await supabase
          .from("program_sessions")
          .select("session_date, session_time")
          .eq("program_id", program.id)
          .gte("session_date", new Date().toISOString().split('T')[0]) // только будущие даты
          .order("session_date", { ascending: true })
          .limit(1)
          .single();
        nextSession = data;
      }

      // // ==========================================
      // // 6) Уведомляем ученика
      // // ==========================================
      // const userTelegramId = updatedApp.users?.telegram_id;
      // let message = `🎉 <b>Запись подтверждена!</b>\n\n` +

      //   `💃 <b>${updatedApp.programs.title}</b>\n` +
      //   `✅ Оплата получена, место закреплено за вами.\n\n` +

      //   `📅 <b>Ближайшее занятие:</b> ${nextSession
      //     ? formatDate(nextSession.session_date)
      //     : "уточняется"
      //   }\n` +

      //   `⏰ <b>Время:</b> ${nextSession?.session_time || "уточняется"
      //   }\n\n` +

      //   `📍 <b>Адрес студии:</b>\n` +
      //   `${config.studio.address}\n\n` +

      //   `👗 <b>Что взять с собой:</b>\n` +
      //   `• удобную одежду\n` +
      //   `• танцевальные туфли на каблуке\n` +
      //   `• воду\n\n` +

      //   `💛 Если планы изменятся — напишите Ане заранее.\n\n` +
      //   `До встречи на тренировке ✨`;
      
      // if (updatedApp.programs.group_link) {
      //   message += `🔗 <b>Ссылка на чат группы:</b>\n${updatedApp.programs.group_link}\n\n`;
      // }
      
      // if (program?.group_link) {
      //   message += `\n🔗 <b>Ссылка на чат группы:</b>\n${program.group_link}\n\n`;
      // }
      // if (userTelegramId) {
      //   await this.bot.sendMessage(
      //     userTelegramId,
      //    message,
      //     {
      //       parse_mode: "HTML",
      //       reply_markup: {
      //         inline_keyboard: [
      //           [{ text: "📅 Мои занятия", callback_data: "nav_my_bookings" }],
      //           [{ text: "💬 Написать Ане", url: "https://t.me/anv_karelina" }],
      //           [{ text: "🏠 В меню", callback_data: "nav_start" }],
      //         ],
      //       },
      //     }
      //   );

      //   console.log(`✅ User notified: ${userTelegramId}`);

      // ==========================================
      // 6) Уведомляем ученика
      // ==========================================
      const userTelegramId = updatedApp.users?.telegram_id;
      const { data: programDb } = await supabase
        .from('programs')
        .select('*')
        .eq('id', updatedApp.program_id)
        .single();
      
      // Определяем текст для занятия
      let scheduleText = '';
      if (nextSession) {
        scheduleText = `📅 <b>Ближайшее занятие:</b> ${formatDate(nextSession.session_date)}\n` +
          `⏰ <b>Время:</b> ${nextSession.session_time || 'уточняется'}`;
      } else if (programDb?.schedule) {
        scheduleText = `📅 <b>Расписание:</b> ${programDb.schedule}`;
      } else {
        scheduleText = `📅 Ближайшее занятие уточняется`;
      }

      let message = `🎉 <b>Запись подтверждена!</b>\n\n` +
        `💃 <b>${updatedApp.programs.title}</b>\n` +
        `✅ Оплата получена, место закреплено за вами.\n\n` +
        scheduleText + `\n\n` +
        `📍 <b>Адрес студии:</b>\n` +
        `${config.studio.address}\n\n` +
        `👗 <b>Что взять с собой:</b>\n` +
        `• удобную одежду\n` +
        `• танцевальные туфли на каблуке\n` +
        `• воду\n\n`;

      if (programDb?.group_link) {
        message += `🔗 <b>Ссылка на чат группы:</b>\n${programDb.group_link}\n\n`;
      } else if (updatedApp.programs?.group_link) {
        message += `🔗 <b>Ссылка на чат группы:</b>\n${updatedApp.programs.group_link}\n\n`;
      }

      message += `💛 Если планы изменятся — напишите Ане заранее.\n\n` +
        `До встречи на тренировке ✨`;

      if (userTelegramId) {
        await this.bot.sendMessage(
          userTelegramId,
          message,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📅 Мои занятия", callback_data: "nav_my_bookings" }],
                [{ text: "💬 Написать Ане", url: "https://t.me/anv_karelina" }],
                [{ text: "🏠 В меню", callback_data: "nav_start" }],
              ],
            },
          }
        );
        console.log(`✅ User notified: ${userTelegramId}`);
      
      }

      
      // ==========================================
      // 7) Увеличиваем участников
      // ==========================================
      await this.programService.incrementParticipants(updatedApp.program_id);

      // ==========================================
      // 8) Сообщение админу
      // ==========================================
      await this.bot.sendMessage(
        userId,
        `✅ Оплата подтверждена для заявки #${applicationId}`
      );

    } catch (error) {
      console.error("❌ Error confirming payment:", error);

      await this.bot.sendMessage(
        userId,
        "❌ Ошибка при подтверждении оплаты"
      );
    }
  }


  async showActivitiesMenu(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    await this.bot.sendMessage(
      chatId,
      "💃 <b>Активности</b>\n\nЧто хочешь сделать?",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Создать активность", callback_data: "admin_add_program" }],
            [{ text: "📋 Список активностей", callback_data: "admin_list_programs" }],
            [{ text: "🗑 Удалить активность", callback_data: "admin_delete_program" }],
            [{ text: "🔙 Назад", callback_data: "admin_panel" }]
          ]
        }
      }
    );
  }




  async showMySchedule(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;
    await this.programService.completePastIntensives();

    try {
      // Получаем только активные программы
      const programs = await this.programService.getAllActive();

      // Фильтруем только активные программы (status = 'active')
      const activePrograms = programs.filter(p => p.status === 'active');

      if (!activePrograms.length) {
        await this.bot.sendMessage(
          chatId,
          "<b>📭 Сейчас нет активных занятий.</b>\n\nНо можно создать!",
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Создать активность", callback_data: "admin_add_program" }],
                [{ text: "📋 Список активностей", callback_data: "admin_list_programs" }],
                [{ text: "🗑 Удалить активность", callback_data: "admin_delete_program" }],
                [{ text: "🏡 В админку", callback_data: "admin_panel" }]
              ]
            }
          }
        );
        return;
      }

      // Группируем программы по типу
      const groupedPrograms: Record<string, any[]> = {
        group: [],
        intensive: [],
        open_group: [],
        individual: []
      };

      activePrograms.forEach(p => {
        if (groupedPrograms[p.type]) {
          groupedPrograms[p.type].push(p);
        }
      });

      // Формируем сообщение
      let msg = `📅 <b>Моё расписание</b>\n\n`;

      // ====================
      // 🔥 ИНТЕНСИВЫ
      // ====================
      // if (groupedPrograms.intensive.length > 0) {
      //   msg += `🔥 <b>ИНТЕНСИВЫ</b>\n\n`;

      //   groupedPrograms.intensive.forEach((p, i) => {
      //     // Форматируем дату начала
      //     const startDate = new Date(p.start_date);
      //     const endDate = p.end_date ? new Date(p.end_date) : null;

      //     let dateRange = formatDate(startDate);
      //     if (endDate) {
      //       dateRange += ` — ${formatDate(endDate)}`;
      //     }

      //     msg += `${i + 1}. <b>${p.title}</b>\n`;
      //     msg += `   📅 <i>${dateRange}</i>\n`;

      //     // Парсим расписание интенсива
      //     if (p.schedule && p.schedule.includes('Расписание интенсива:')) {
      //       // Извлекаем только строки с датами и временем
      //       const scheduleLines = p.schedule.split('\n').filter(line =>
      //         line.includes('—') && line.includes('<b>')
      //       );

      //       scheduleLines.forEach(line => {
      //         // Убираем HTML теги
      //         const cleanLine = line.replace(/<[^>]*>/g, '');
      //         msg += `   ⏰ ${cleanLine}\n`;
      //       });
      //     } else {
      //       msg += `   ⏰ ${p.schedule || 'Расписание не указано'}\n`;
      //     }

      //     msg += `   👥 ${p.current_participants}/${p.max_participants}\n`;
      //     msg += `   💰 ${p.price} ₽\n\n`;
      //   });

      //   msg += `\n`;
      // }

      // ====================
      // 🔥 ИНТЕНСИВЫ
      // ====================
      if (groupedPrograms.intensive.length > 0) {
        msg += `🔥 <b>ИНТЕНСИВЫ</b>\n\n`;

        groupedPrograms.intensive.forEach((p, i) => {
          // Форматируем дату начала
          const startDate = new Date(p.start_date);
          const endDate = p.end_date ? new Date(p.end_date) : null;

          let dateRange = formatDate(startDate);
          if (endDate) {
            dateRange += ` — ${formatDate(endDate)}`;
          }

          msg += `${i + 1}. <b>${p.title}</b>\n`;
          msg += `   📅 <i>${dateRange}</i>\n`;

          // Парсим расписание интенсива - улучшенная версия
          if (p.schedule) {
            if (p.schedule.includes('—')) {
              // Если это уже отформатированное расписание с тире
              const lines = p.schedule.split('\n');
              lines.forEach(line => {
                if (line.includes('—')) {
                  // Убираем HTML теги для чистоты
                  const cleanLine = line.replace(/<[^>]*>/g, '');
                  msg += `   ⏰ ${cleanLine}\n`;
                }
              });
            } else {
              // Если это просто список дат, добавляем заглушку
              msg += `   ⏰ Расписание уточняется\n`;
            }
          } else {
            msg += `   ⏰ Расписание не указано\n`;
          }

          msg += `   👥 ${p.current_participants}/${p.max_participants}\n`;
          msg += `   💰 ${p.price} ₽\n`;
          if (p.group_link) {
            msg += `   🔗 <a href="${p.group_link}">Ссылка на чат</a>\n`;
          }
          msg += `\n`;
        });

        msg += `\n`;
      }

      // ====================
      // 👥 ГРУППОВЫЕ ЗАНЯТИЯ
      // ====================
      if (groupedPrograms.group.length > 0) {
        msg += `👥 <b>ГРУППОВЫЕ ЗАНЯТИЯ</b>\n\n`;

        groupedPrograms.group.forEach((p, i) => {
          const startDate = new Date(p.start_date);

          msg += `${i + 1}. <b>${p.title}</b>\n`;
          msg += `   📅 Старт: <i>${formatDate(startDate)}</i>\n`;
          msg += `   ⏰ ${p.schedule}\n`;
          msg += `   👥 ${p.current_participants}/${p.max_participants}\n`;
          msg += `   💰 ${p.price} ₽\n\n`;
        });

        msg += `\n`;
      }

      // ====================
      // 🎪 ОТКРЫТЫЕ ГРУППЫ
      // ====================
      if (groupedPrograms.open_group.length > 0) {
        msg += `🎪 <b>ОТКРЫТЫЕ ГРУППЫ</b>\n\n`;

        groupedPrograms.open_group.forEach((p, i) => {
          const startDate = new Date(p.start_date);

          msg += `${i + 1}. <b>${p.title}</b>\n`;
          msg += `   📅 Старт: <i>${formatDate(startDate)}</i>\n`;
          msg += `   ⏰ ${p.schedule}\n`;
          msg += `   💰 Цикл: ${p.price} ₽ / Разово: ${p.single_price} ₽\n`;
          msg += `   👥 ${p.current_participants}/${p.max_participants}\n\n`;
        });

        msg += `\n`;
      }

      // ====================
      // 👠 ИНДИВИДУАЛЬНЫЕ
      // ====================
      if (groupedPrograms.individual.length > 0) {
        msg += `👠 <b>ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ</b>\n\n`;

        groupedPrograms.individual.forEach((p, i) => {
          const duration = p.duration_minutes === 60 ? '1 час' :
            p.duration_minutes === 90 ? '1,5 часа' :
              `${p.duration_minutes} мин`;

          msg += `${i + 1}. <b>${p.title}</b>\n`;
          msg += `   ⏱ Длительность: ${duration}\n`;
          msg += `   💰 ${p.price} ₽\n`;
          msg += `   👥 ${p.current_participants}/${p.max_participants}\n\n`;
        });
      }

      // ====================
      // ⚠️ ПРЕДУПРЕЖДЕНИЯ О ПЕРЕСЕЧЕНИЯХ
      // ====================
      const warnings = this.findScheduleConflicts(activePrograms);
      if (warnings.length > 0) {
        msg += `\n⚠️ <b>Внимание! Возможные пересечения:</b>\n`;
        warnings.forEach(warning => {
          msg += `• ${warning}\n`;
        });
      }

      // ====================
      // 📊 СТАТИСТИКА
      // ====================
      const totalParticipants = activePrograms.reduce((sum, p) => sum + p.current_participants, 0);
      const totalCapacity = activePrograms.reduce((sum, p) => sum + p.max_participants, 0);
      const occupancyRate = totalCapacity > 0 ? Math.round((totalParticipants / totalCapacity) * 100) : 0;

      msg += `\n📊 <b>Общая статистика:</b>\n`;
      msg += `• Всего активных занятий: ${activePrograms.length}\n`;
      msg += `• Участников: ${totalParticipants}/${totalCapacity} (${occupancyRate}%)\n`;
      msg += `• Интенсивы: ${groupedPrograms.intensive.length}\n`;
      msg += `• Групповые: ${groupedPrograms.group.length}\n`;
      msg += `• Открытые группы: ${groupedPrograms.open_group.length}\n`;
      msg += `• Индивидуальные: ${groupedPrograms.individual.length}\n`;

      await this.bot.sendMessage(chatId, msg, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Обновить", callback_data: "admin_my_schedule" }],
            [{ text: "🏡 В админку", callback_data: "admin_panel" }]
          ]
        }
      });

    } catch (error) {
      console.error("Error showing admin schedule:", error);
      await this.bot.sendMessage(chatId, "❌ Ошибка загрузки расписания", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🏡 В админку", callback_data: "admin_panel" }]
          ]
        }
      });
    }
  }

  // ====================
  // 🔧 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ====================

  private findScheduleConflicts(programs: any[]): string[] {
    const warnings: string[] = [];

    // Собираем все занятия с временем
    const timeSlots: Array<{
      programTitle: string;
      date: Date;
      time: string;
      duration: number;
      type: string;
    }> = [];

    programs.forEach(program => {
      // Обрабатываем расписание интенсива
      if (program.type === 'intensive' && program.start_date && program.end_date) {
        const startDate = new Date(program.start_date);
        const endDate = new Date(program.end_date);
        const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

        // Парсим расписание интенсива
        if (program.schedule && program.schedule.includes('Расписание интенсива:')) {
          const scheduleLines = program.schedule.split('\n').filter(line =>
            line.includes('—') && line.includes('<b>')
          );

          scheduleLines.forEach((line, index) => {
            const cleanLine = line.replace(/<[^>]*>/g, '');
            const parts = cleanLine.split('—');
            if (parts.length >= 2) {
              const dateTimeStr = parts[0].trim();
              const timeStr = parts[1].trim();

              // Пытаемся извлечь время
              const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
              if (timeMatch) {
                const date = new Date(startDate);
                date.setDate(startDate.getDate() + index);
                date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]));

                timeSlots.push({
                  programTitle: program.title,
                  date: date,
                  time: timeStr,
                  duration: program.duration_minutes || 90,
                  type: program.type
                });
              }
            }
          });
        }
      }

      // Обрабатываем регулярные занятия (группы и открытые группы)
      if (['group', 'open_group'].includes(program.type) && program.schedule) {
        // Парсим расписание вида "Вт 19:30–21:00, Чт 19:00–20:30"
        const scheduleParts = program.schedule.split(',').map(s => s.trim());

        scheduleParts.forEach(part => {
          // Пример: "Вт 19:30–21:00"
          const match = part.match(/(\S+)\s+(\d{1,2}:\d{2})–(\d{1,2}:\d{2})/);
          if (match) {
            const [, dayOfWeek, startTime, endTime] = match;

            // Здесь можно было бы вычислить дату на основе дня недели и start_date
            // но это сложнее, так как нужно учитывать недельный цикл
            // Для простоты пока пропускаем
          }
        });
      }
    });

    // Проверяем пересечения по времени (упрощенная проверка)
    for (let i = 0; i < timeSlots.length; i++) {
      for (let j = i + 1; j < timeSlots.length; j++) {
        const slot1 = timeSlots[i];
        const slot2 = timeSlots[j];

        // Проверяем, что занятия в один день
        if (slot1.date.toDateString() === slot2.date.toDateString()) {
          warnings.push(`${slot1.programTitle} и ${slot2.programTitle} могут пересекаться ${formatDate(slot1.date)}`);
        }
      }
    }

    return warnings;
  }

  // Добавьте эту функцию для форматирования дат
  private formatProgramDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'long'
    };
    return date.toLocaleDateString('ru-RU', options);
  }

  async listPrograms(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    const programs = await this.programService.getAllActive();

    if (!programs.length) {
      await this.bot.sendMessage(chatId, "📭 Активностей пока нет.");
      return;
    }

    let msg = `📋 <b>Созданные активности</b>\n\n`;

    programs.forEach(p => {
      msg += `• <b>${p.title}</b>\n`;
      msg += `   ID: #${p.id}\n`;
      msg += `   📅 ${p.start_date}\n\n`;
    });

    await this.bot.sendMessage(chatId, msg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: "admin_activities" }]]
      }
    });
  }

  async deleteProgramMenu(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    const programs = await this.programService.getAllActive();

    if (!programs.length) {
      await this.bot.sendMessage(chatId, "📭 Нет активных занятий для удаления.");
      return;
    }

    const keyboard = programs.map(p => [
      {
        text: `🗑 ${p.title}`,
        callback_data: `admin_delete_${p.id}`
      }
    ]);

    keyboard.push([{ text: "🔙 Назад", callback_data: "admin_activities" }]);

    await this.bot.sendMessage(chatId, "Выбери активность для удаления:", {
      reply_markup: { inline_keyboard: keyboard }
    });
  }


  async deleteProgramById(chatId: number, programId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    try {
      await this.programService.deleteProgram(programId);

      await this.bot.sendMessage(chatId, "✅ Активность удалена!");

      await this.showActivitiesMenu(chatId, userId);
    } catch (error) {
      console.error("Ошибка удаления:", error);

      await this.bot.sendMessage(chatId, "❌ Не удалось удалить активность.");
    }
  }


  // async startBroadcast(chatId: number, userId?: number) {
  //   if (!await this.checkAccess(chatId, userId)) return;

  //   this.broadcastMode = true;

  //   await this.bot.sendMessage(
  //     chatId,
  //     "📢 <b>Рассылка</b>\n\n✍️ Напиши сообщение, которое нужно отправить всем ученикам:",
  //     {
  //       parse_mode: "HTML",
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: "❌ Отмена", callback_data: "broadcast_cancel" }]
  //         ]
  //       }
  //     }
  //   );
  // }


  async startBroadcast(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    // Показываем меню выбора сегмента
    await this.showBroadcastSegmentMenu(chatId);
  }

  async showBroadcastSegmentMenu(chatId: number) {
    const programs = await this.programService.getAllActive();

    if (!programs.length) {
      await this.bot.sendMessage(chatId, "📭 Нет активных занятий для рассылки");
      return;
    }

    const keyboard = programs.map(p => [
      {
        text: `💃 ${p.title}`,
        callback_data: `broadcast_program_${p.id}`
      }
    ]);

    keyboard.push(
      [{ text: "📌 Всем активным ученикам", callback_data: "broadcast_active" }],
      [{ text: "👥 Всем вообще", callback_data: "broadcast_all" }],
      [{ text: "❌ Отмена", callback_data: "broadcast_cancel" }]
    );

    await this.bot.sendMessage(chatId, "📢 Кому отправить сообщение?", {
      reply_markup: { inline_keyboard: keyboard }
    });
  }


  async handleSegmentSelection(chatId: number, segment: string, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    this.broadcastSegment = segment;
    this.broadcastMode = true;

    let segmentDescription = '';

    if (segment === 'all') {
      segmentDescription = 'всем ученикам';
    } else if (segment === 'active') {
      segmentDescription = 'всем активным ученикам (с подтверждёнными записями)';
    } else if (segment.startsWith('program_')) {
      const programId = Number(segment.replace('program_', ''));
      // Можно загрузить название программы для красоты
      const program = await this.programService.getById(programId);
      segmentDescription = program
        ? `участникам программы «${program.title}»`
        : `участникам программы #${programId}`;
    } else {
      // Для обратной совместимости с другими типами (group, individual и т.д.)
      const segmentNames: Record<string, string> = {
        'group': 'ученикам групповых занятий',
        'individual': 'ученикам индивидуальных занятий',
        'open_group': 'ученикам открытых групп',
        'intensive': 'ученикам интенсивов'
      };
      segmentDescription = segmentNames[segment] || `сегменту "${segment}"`;
    }

    await this.bot.sendMessage(
      chatId,
      `✍️ <b>Текст рассылки</b>\n` +
      `────────────────\n` +
      `<i>Кому:</i> <b>${segmentDescription}</b>\n\n` +
      `👇 Пиши ниже:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚫 Отмена', callback_data: 'broadcast_cancel' }]
          ]
        }
      }
    );
  }

  async handleBroadcastMessage(chatId: number, text: string): Promise<boolean> {
    if (!this.broadcastMode) return false;

    this.broadcastText = text;
    this.broadcastMode = false;

    // Получаем пользователей для выбранного сегмента
    const users = await this.adminService.getUsersBySegment(this.broadcastSegment);
    const count = users.length;

    if (count === 0) {
      await this.bot.sendMessage(
        chatId,
        `❌ <b>Нет получателей!</b>\n\n` +
        `Для выбранного сегмента не найдено ни одного пользователя.`,
        { parse_mode: 'HTML' }
      );
      this.broadcastText = null;
      return true;
    }

    const segmentNames = {
      'all': 'всем ученикам',
      'group': 'ученикам групповых занятий',
      'individual': 'ученикам индивидуальных занятий',
      'open_group': 'ученикам открытых групп',
      'intensive': 'ученикам интенсивов'
    };

    const segmentLabel =
      this.broadcastSegment === "all"
        ? "всем ученикам"
        : this.broadcastSegment === "active"
          ? "всем активным"
          : this.broadcastSegment.startsWith("program_")
            ? "участникам выбранной активности"
            : "получателям";

    await this.bot.sendMessage(
      chatId,
      `👀 <b>Предпросмотр рассылки:</b>\n\n${text}\n\n` +
      `📊 <b>Получатели:</b> ${segmentLabel} (${count} чел.)\n\n` +
      `Отправляем сообщение?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✅ Да, отправить (${count})`, callback_data: "broadcast_confirm" },
              { text: "❌ Отмена", callback_data: "broadcast_cancel" }
            ]
          ]
        }
      }
    );

    return true;
  }

  async confirmBroadcast(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;
    if (!this.broadcastText) {
      await this.bot.sendMessage(chatId, "❌ Нет текста для рассылки.");
      return;
    }

    // Получаем пользователей
    const users = await this.adminService.getUsersBySegment(this.broadcastSegment);
    const total = users.length;

    if (total === 0) {
      await this.bot.sendMessage(chatId, "❌ Нет получателей для рассылки.");
      this.broadcastText = null;
      return;
    }

    await this.bot.sendMessage(chatId, `🚀 Начинаю рассылку для ${total} пользователей...`);

    let success = 0;
    let failed = 0;
    const failedUsers: string[] = [];

    // Отправляем сообщения
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      try {
        const message = `💌 *Сообщение от Ани!*\n\n${this.broadcastText}\n\nЕсли есть вопросы, пиши в личку 🤗\n\nP.S. Это рассылка через нашего ботика, чтобы я могла оперативно делиться важным с вами 💫`;

        await this.bot.sendMessage(user.telegram_id, message, {
          parse_mode: 'Markdown'
        });
        success++;

        // Пауза между отправками
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error(`Failed to send to user ${user.telegram_id}:`, error);
        failed++;
        failedUsers.push(user.first_name || `User ${user.telegram_id}`);
      }
    }

    // Итоговое сообщение
    const segmentNames = {
      'all': 'Всем ученикам',
      'group': 'Ученикам групповых занятий',
      'individual': 'Ученикам индивидуальных занятий',
      'open_group': 'Ученикам открытых групп',
      'intensive': 'Ученикам интенсивов'
    };
    const segmentLabel =
      this.broadcastSegment === "all"
        ? "всем ученикам"
        : this.broadcastSegment === "active"
          ? "всем активным"
          : this.broadcastSegment.startsWith("program_")
            ? "участникам выбранной активности"
            : "получателям";

    let resultMessage = `✅ <b>Рассылка завершена!</b>\n\n` +
      `<b>Сегмент:</b> ${segmentLabel}\n` +
      `<b>📩 Успешно:</b> ${success}\n` +
      `<b>⚠️ Ошибок:</b> ${failed}\n` +
      `<b>📊 Всего:</b> ${total}`;

    if (failed > 0 && failedUsers.length > 0) {
      resultMessage += `\n\n<b>Не удалось отправить:</b>\n`;
      resultMessage += failedUsers.slice(0, 5).map(name => `• ${name}`).join('\n');
      if (failedUsers.length > 5) {
        resultMessage += `\n• ...и еще ${failedUsers.length - 5}`;
      }
    }

    await this.bot.sendMessage(
      chatId,
      resultMessage,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Новая рассылка", callback_data: "admin_broadcast" }],
            [{ text: "🏡 В админку", callback_data: "admin_panel" }]
          ]
        }
      }
    );

    // Сбрасываем состояние
    this.broadcastText = null;
    this.broadcastSegment = 'all';
  }

  async cancelBroadcast(chatId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    this.broadcastMode = false;
    this.broadcastText = null;
    this.broadcastSegment = 'all';

    await this.bot.sendMessage(chatId, "❌ Рассылка отменена.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🏡 В админку", callback_data: "admin_panel" }]
        ]
      }
    });
  }

  // Обработка callback-запросов
  async handleCallbackQuery(callbackQuery: TelegramBot.CallbackQuery) {
    const { data, message, from } = callbackQuery;
    const chatId = message?.chat.id;
    const userId = from?.id;

    if (!chatId || !data) return;

    try {

      // 💃 Выбор конкретной активности
      if (data.startsWith("broadcast_program_")) {
        const programId = Number(data.replace("broadcast_program_", ""));
        this.broadcastSegment = `program_${programId}`;
        this.broadcastMode = true;

        await this.bot.sendMessage(
          chatId,
          "✍️ Напиши сообщение для участников этой активности:"
        );
        return;
      }

      // 📌 Всем активным
      if (data === "broadcast_active") {
        this.broadcastSegment = "active";
        this.broadcastMode = true;

        await this.bot.sendMessage(chatId, "✍️ Напиши сообщение для всех активных учеников:");
        return;
      }

      // 👥 Всем вообще
      if (data === "broadcast_all") {
        this.broadcastSegment = "all";
        this.broadcastMode = true;

        await this.bot.sendMessage(chatId, "✍️ Напиши сообщение для всех учеников:");
        return;
      }

      // ✅ Подтверждение
      if (data === "broadcast_confirm") {
        await this.confirmBroadcast(chatId, userId);
        return;
      }

      // ❌ Отмена
      if (data === "broadcast_cancel") {
        await this.cancelBroadcast(chatId, userId);
        return;
      }

      // Запуск меню
      if (data === "admin_broadcast") {
        await this.startBroadcast(chatId, userId);
        return;
      }

      await this.bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
      console.error("Broadcast callback error:", error);
    }
  }

  async startBroadcastForProgram(chatId: number, programId: number, userId?: number) {
    if (!await this.checkAccess(chatId, userId)) return;

    this.broadcastSegment = `program_${programId}`;
    this.broadcastMode = true;

    await this.bot.sendMessage(
      chatId,
      "✍️ Напиши сообщение для участников этой активности:"
    );
  }

}
