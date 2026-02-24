import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { formatCurrency, escapeHtml } from './formatters';
import { AdminService } from '../database/services/AdminService';
import { supabase } from '../database/supabase';
import { BookingService } from '../database/services/BookingService';

export class NotificationService {
  private adminService: AdminService;
  private bookingService: BookingService;

  constructor(
    private bot: TelegramBot,
    adminService?: AdminService
  ) {
    this.adminService = adminService || new AdminService();
  }

  async sendNewApplication(
    application: any,
    userData: {
      programTitle: string;
      userName: string;
      telegramUsername?: string;
      phone?: string;
    }
  ): Promise<void> {

    // ================================
    // ✅ заметки пользователя
    // ================================
    const notes =
      application.user_notes && application.user_notes.trim().length > 0
        ? escapeHtml(application.user_notes)
        : "нет";

    // ================================
    // ✅ статус заявки
    // ================================
    const statusText =
      application.status === "pending"
        ? "⏳ ожидает подтверждения оплаты"
        : application.status === "confirmed"
          ? "✅ подтверждена"
          : "❌ отклонена";

    // ================================
    // ✅ тип записи + даты занятий
    // ================================
    let bookingTypeText = "";
    let sessionsText = "";

    // 🎫 Разовое занятие
    if (application.session_id) {
      bookingTypeText = "🎫 <b>Разовое занятие</b>";

      const { data: session } = await supabase
        .from("program_sessions")
        .select("session_date, session_time")
        .eq("id", application.session_id)
        .single();

      if (session) {
        sessionsText =
          `🗓 <b>Дата занятия:</b> ${new Date(session.session_date)
            .toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "long",
              weekday: "short"
            })} — ${session.session_time}`;
      }
    }

    // 📦 Абонемент на 4 занятия
    else if (application.session_ids?.length) {
      bookingTypeText = "📦 <b>Абонемент (4 занятия)</b>";

      const ids = application.session_ids.map((id: any) => Number(id));

      const { data: sessions } = await supabase
        .from("program_sessions")
        .select("session_date, session_time")
        .in("id", ids);

      if (sessions?.length) {
        sessions.sort(
          (a, b) =>
            new Date(a.session_date).getTime() -
            new Date(b.session_date).getTime()
        );

        sessionsText =
          `📅 <b>Выбранные даты:</b>\n` +
          sessions
            .map(
              (s) =>
                `• ${new Date(s.session_date).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "long",
                  weekday: "short"
                })} — ${s.session_time}`
            )
            .join("\n");
      }
    }

    // ================================
    // ✅ сообщение админу
    // ================================
    const message =
      `🎉 <b>НОВАЯ ЗАЯВКА!</b>\n\n` +

      `👤 <b>Имя:</b> ${escapeHtml(userData.userName)}\n` +
      `💬 <b>Telegram:</b> ${userData.telegramUsername
        ? `@${userData.telegramUsername}`
        : "не указан"
      }\n` +
      `📞 <b>Телефон:</b> <code>${escapeHtml(userData.phone || "")}</code>\n\n` +

      `💃 <b>Программа:</b> ${escapeHtml(userData.programTitle)}\n` +
      `💰 <b>Сумма:</b> ${formatCurrency(application.amount)}\n\n` +

      // 🔥 новый блок
      (bookingTypeText ? `${bookingTypeText}\n` : "") +
      (sessionsText ? `${sessionsText}\n\n` : "") +

      `📝 <b>Комментарий:</b> ${notes}\n\n` +

      `📌 <b>Статус:</b> ${statusText}\n` +
      `🆔 <b>ID заявки:</b> ${application.id}\n` +
      `⏰ <b>Время:</b> ${new Date().toLocaleString("ru-RU")}`;

    // ================================
    // ✅ отправляем всем админам
    // ================================
    await this.sendToAdmins(message, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Подтвердить",
              callback_data: `admin_confirm_${application.id}`
            },
            {
              text: "❌ Отклонить",
              callback_data: `admin_reject_${application.id}`
            }
          ],
          [
            {
              text: "📞 Позвонить",
              callback_data: `admin_call_${application.id}`
            },
            {
              text: "💬 Написать",
              url: userData.telegramUsername
                ? `https://t.me/${userData.telegramUsername}`
                : "#"
            }
          ]
        ]
      }
    });
  }

  async sendToAdmins(message: string, options?: any): Promise<void> {
    try {
      const rawAdminIds = await this.adminService.getAdminIds();

      // Coerce to numbers, filter invalid values and dedupe
      const normalized = new Set<number>();
      const skipped: any[] = [];

      for (const id of rawAdminIds || []) {
        const n = Number(id);
        if (!isNaN(n) && n > 0) normalized.add(n);
        else skipped.push(id);
      }

      // Добавляем ID Ани из конфига
      if (config.annaTelegramId) {
        const annaId = Number(config.annaTelegramId);
        if (!isNaN(annaId) && annaId > 0) normalized.add(annaId);
      }

      if (skipped.length) {
        console.warn('sendToAdmins: skipped invalid admin ids from DB:', skipped);
      }

      // Отправляем всем уникальным администраторам
      for (const adminId of Array.from(normalized)) {
        try {
          await this.bot.sendMessage(adminId, message, {
            parse_mode: 'HTML',
            ...options
          });
        } catch (error) {
          console.error(`Failed to send notification to admin ${adminId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error sending notifications to admins:', error);
    }
  }

  async sendToUser(userId: number, message: string): Promise<void> {
    try {
      await this.bot.sendMessage(userId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`Failed to send notification to user ${userId}:`, error);
    }
  }

}

