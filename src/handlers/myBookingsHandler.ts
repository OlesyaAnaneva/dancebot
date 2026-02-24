import TelegramBot from "node-telegram-bot-api";
import { BookingService } from "../database/services/BookingService";
import { ApplicationService } from "../database/services/ApplicationService";
import { UserService } from "../database/services/UserService";
import { escapeHtml, formatCurrency, formatDate } from "../utils/formatters";
import { supabase } from "../database/supabase";

export class MyBookingsHandler {
  constructor(
    private bot: TelegramBot,
    private bookingService: BookingService,
    private applicationService: ApplicationService,
    private userService: UserService
  ) { }

  // ================================
  // 📅 МОИ ЗАНЯТИЯ (идеально правильно)
  // ================================
  async showMyBookings(chatId: number, telegramId: number) {
    const user = await this.userService.getByTelegramId(telegramId);
    if (!user) return;

    const bookings = await this.bookingService.getByUserId(user.id);
    const pending = await this.applicationService.getPendingByUserId(user.id);

    // Если вообще ничего нет
    if (!bookings.length && !pending.length) {
      await this.bot.sendMessage(
        chatId,
        `📭 <b>У тебя пока нет записей</b>\n\nХочешь записаться?`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💃 Записаться", callback_data: "nav_programs" }],
            ],
          },
        }
      );
      return;
    }

    let msg = `📅 <b>Мои занятия</b>\n\n`;

    // ================================
    // ✅ Подтвержденные записи
    // ================================
    for (const b of bookings) {
      const program = b.programs;
      if (!program || program.status !== 'active') continue; // ← пропускаем удалённые

      msg += `💃 <b>${escapeHtml(program.title)}</b>\n`;
      if (program.group_link) {
        msg += `🔗 <b>Чат группы:</b> <a href="${program.group_link}">перейти</a>\n`;
      }
      // ============================================
      // 🎫 Разовое занятие → показываем конкретную дату
      // ============================================
      if (b.session_id) {
        const { data: session } = await supabase
          .from("program_sessions")
          .select("session_date, session_time")
          .eq("id", b.session_id)
          .single();

        if (session) {
          msg += `📅 ${formatDate(session.session_date)} — ${escapeHtml(
            session.session_time
          )}\n`;
        } else {
          msg += `📅 Дата занятия уточняется\n`;
        }
      }

      // ============================================
      // 📦 Абонемент / курс → показываем расписание программы
      // ============================================
    //   else {
    //     const { data: sessions, error } = await supabase
    //       .from("booking_sessions")
    //       .select(`
    //   session_id,
    //   program_sessions (
    //     session_date,
    //     session_time
    //   )
    // `)
    //       .eq("booking_id", b.id);

    //     if (error) {
    //       console.error("❌ Ошибка загрузки дат абонемента:", error);
    //       msg += `📅 Даты занятий уточняются\n`;
    //     }

    //     else if (sessions && sessions.length > 0) {
    //       msg += `📅 <b>Ваши занятия:</b>\n`;

    //       sessions.forEach((s: any) => {
    //         if (s.program_sessions) {
    //           msg += `• ${formatDate(s.program_sessions.session_date)} — ${escapeHtml(
    //             s.program_sessions.session_time
    //           )}\n`;
    //         }
    //       });
    //     }

    //     else {
    //       msg += `📅 Даты занятий ещё не выбраны\n`;
    //     }
    //   }

      // ============================================
      // 📦 Абонемент / курс → показываем расписание в зависимости от типа программы
      // ============================================
      else {
        const program = b.programs;

        if (!program) {
          msg += `📅 Даты занятий уточняются\n`;
        }
        // 🚪 Открытая группа с абонементом — показываем выбранные даты
        else if (program.type === 'open_group') {
          const { data: sessions, error } = await supabase
            .from("booking_sessions")
            .select(`
        session_id,
        program_sessions (
          session_date,
          session_time
        )
      `)
            .eq("booking_id", b.id);

          if (error || !sessions?.length) {
            msg += `📅 Даты занятий ещё не выбраны\n`;
          } else {
            msg += `📅 <b>Ваши занятия:</b>\n`;
            sessions.slice(0, 4).forEach((s: any) => { // покажем первые 4 даты
              if (s.program_sessions) {
                msg += `• ${formatDate(s.program_sessions.session_date)} — ${escapeHtml(
                  s.program_sessions.session_time
                )}\n`;
              }
            });
            if (sessions.length > 4) {
              msg += `• и ещё ${sessions.length - 4} занятий...\n`;
            }
          }
        }
        // 👥 Групповые занятия и интенсивы — показываем расписание программы
        else if (['group', 'intensive'].includes(program.type)) {
          // Берём ближайшие 4 сессии из расписания программы
          const { data: sessions, error } = await supabase
            .from("program_sessions")
            .select("session_date, session_time")
            .eq("program_id", program.id)
            .gte("session_date", new Date().toISOString().split('T')[0])
            .order("session_date", { ascending: true })
            .limit(4);

          if (error || !sessions?.length) {
            // Если нет сессий в БД — показываем текстовое расписание из программы
            msg += `📅 ${program.schedule || 'Расписание уточняется'}\n`;
          } else {
            msg += `📅 <b>Ближайшие занятия:</b>\n`;
            sessions.forEach((s: any) => {
              msg += `• ${formatDate(s.session_date)} — ${escapeHtml(s.session_time)}\n`;
            });
          }
        } else {
          msg += `📅 Даты занятий уточняются\n`;
        }
      }
      
      msg += `💰 <b>Оплачено:</b> ${formatCurrency(b.amount)}\n\n`;
      
    }

    // ================================
    // ⏳ Pending заявки
    // ================================
    if (pending.length) {
      msg += `⏳ <b>Ожидают подтверждения:</b>\n\n`;

      pending.forEach((a) => {
        msg += `🎫 <b>${escapeHtml(a.programs?.title || "Занятие")}</b>\n`;
        msg += `💰 ${formatCurrency(a.amount)}\n`;
        msg += `🆔 Заявка #${a.id}\n\n`;
      });
    }

    msg += `💛 Если есть вопросы — просто напиши Ане`;

    // ================================
    // Кнопки
    // ================================
    await this.bot.sendMessage(chatId, msg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💃 Записаться ещё", callback_data: "nav_programs" }],
          [{ text: "💬 Написать Ане", url: "https://t.me/anv_karelina" }],
          [{ text: "🏠 В меню", callback_data: "nav_start" }],
        ],
      },
    });
  }
}
