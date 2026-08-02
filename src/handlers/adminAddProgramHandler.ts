import TelegramBot from "node-telegram-bot-api";
import { ProgramService } from "../database/services/ProgramService";
import { addDuration } from "../utils/formatters";
import { generateSessions } from "../utils/scheduleGenerator";

interface ScheduleEntry {
  day: string;
  time: string;
  duration: number;
}

interface ProgramDraft {
  type?: string;
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  duration_minutes?: number;
  schedule?: string;
  is_recurring?: boolean;
  // 💰 цены
  price?: number;         // цена за цикл
  single_price?: number;  // разовое занятие
  max_participants?: number;
  group_link?: string | null;
  scheduleDetails?: ScheduleEntry[]; // 👈 добавляем это поле

}



export class AdminAddProgramHandler {
  private drafts: Record<number, ProgramDraft> = {};
  private steps: Record<number, string> = {};
  private intensiveDays: Record<number, number> = {};
  private intensiveTimes: Record<number, string[]> = {};
  private intensiveCurrentDay: Record<number, number> = {};
  private tempTime: Record<number, string> = {};

  // Для индивидуальных занятий
  private tempDays: string[] = []; // Выбранные дни для индивидуальных
  private currentDayIndex: number = 0;

  // расписание-конструктор
  private scheduleDraft: Record<number, string[]> = {};
  private tempDay: Record<number, string> = {};

  // Добавьте новые поля в класс
  private scheduleDetails: Record<number, ScheduleEntry[]> = {};
  private tempDuration: Record<number, number> = {}; // для временного хранения длительности


  constructor(
    private bot: TelegramBot,
    private programService: ProgramService
  ) { }

  // -----------------------------
  // helpers
  // -----------------------------
  private cancelKeyboard() {
    return {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: "add_cancel" }]],
    };
  }

  private formatDate(offsetDays: number) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();

    return `${dd}.${mm}.${yyyy}`;
  }


  // формат расписания красиво
  private formatSchedule(entries: string[]) {
    return entries.join(", ");
  }

  // -----------------------------
  // START
  // -----------------------------
  async start(chatId: number) {
    this.drafts[chatId] = {};
    this.steps[chatId] = "";
    await this.bot.sendMessage(
      chatId,
      "➕ <b>Добавим новое занятие!</b>\nВыбери формат:",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👥 Группа", callback_data: "add_type_group" }],
            [{ text: "🔥 Интенсив", callback_data: "add_type_intensive" }],
            [{ text: "🎪 Открытая группа", callback_data: "add_type_open_group" }],
            [{ text: "👠 Индивидуальные", callback_data: "add_type_individual" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
            [{ text: "🏠 В админку", callback_data: "admin_panel" }],
          ],
        },
      }
    );
  }

  async setType(chatId: number, type: string) {
    if (!this.drafts[chatId]) {
      this.drafts[chatId] = {};
    }

    this.drafts[chatId].type = type;

    // Для групп и открытых групп не спрашиваем длительность сразу
    if (type === "group" || type === "open_group") {
      this.steps[chatId] = "title";
      await this.bot.sendMessage(chatId, "✏️ Напиши название занятия:", {
        reply_markup: this.cancelKeyboard(),
      });
      return;
    }

    // Для интенсивов и индивидуальных оставляем как есть
    this.steps[chatId] = "duration_choice";
    await this.bot.sendMessage(
      chatId,
      "⏱ Сколько будет длиться занятие?",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "1 час", callback_data: "duration_60" }],
            [{ text: "1,5 часа", callback_data: "duration_90" }],
            [{ text: "2 часа", callback_data: "duration_120" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  // -----------------------------
  // TITLE
  // -----------------------------
  async setTitle(chatId: number, text: string) {
    this.drafts[chatId].title = text;

    // Если интенсив — сразу к описанию
    if (this.drafts[chatId].type === "intensive") {
      this.steps[chatId] = "description";
      await this.bot.sendMessage(chatId, "📝 Добавь описание интенсива:", {
        reply_markup: this.cancelKeyboard(),
      });
      return;
    }

    this.steps[chatId] = "description";
    await this.bot.sendMessage(chatId, "📝 Добавь описание занятия:", {
      reply_markup: this.cancelKeyboard(),
    });
  }

  // -----------------------------
  // DESCRIPTION
  // -----------------------------
  async setDescription(chatId: number, text: string) {
    this.drafts[chatId].description = text;
    this.steps[chatId] = "start_date_choice";
    await this.askStartDate(chatId);
  }

  // -----------------------------
  // DATE PICKER
  // -----------------------------
  async askStartDate(chatId: number) {
    await this.bot.sendMessage(chatId, "📅 Выбери дату старта:", {
      reply_markup: {
        inline_keyboard: [
          // [{ text: "Сегодня", callback_data: "add_date_today" }],
          // [{ text: "Завтра", callback_data: "add_date_tomorrow" }],
          // [{ text: "Через неделю", callback_data: "add_date_week" }],
          [{ text: "✍️ Ввести вручную", callback_data: "add_date_manual" }],
          [{ text: "❌ Отмена", callback_data: "add_cancel" }],
        ],
      },
    });
  }

  async setStartDate(chatId: number, date: string) {

    // ✅ формат строго: ДД.ММ.ГГ
    const regex = /^\d{2}\.\d{2}\.\d{2}$/;

    if (!regex.test(date)) {
      await this.bot.sendMessage(
        chatId,
        "❌ Формат даты неверный.\nПример: 03.03.26"
      );
      return;
    }

    // разбираем дату
    let [dd, mm, yy] = date.split(".");

    // ✅ превращаем 26 → 2026
    const yyyy = "20" + yy;

    // ISO формат для базы
    const isoDate = `${yyyy}-${mm}-${dd}`;

    // сохраняем
    this.drafts[chatId].start_date = isoDate;

    // ==============================
    // 🔥 ЕСЛИ ЭТО ИНТЕНСИВ
    // ==============================
    if (this.drafts[chatId].type === "intensive") {

      const days = this.intensiveDays[chatId];

      if (!days || days <= 0) {
        await this.bot.sendMessage(
          chatId,
          "❌ Сначала выбери сколько дней длится интенсив"
        );
        return;
      }

      // ✅ правильный парсинг ISO даты
      const [y, m, d] = isoDate.split("-").map(Number);

      const start = new Date(y, m - 1, d);
      const end = new Date(start);

      end.setDate(end.getDate() + (days - 1));

      this.drafts[chatId].end_date = end.toISOString().split("T")[0];

      // красивый вывод дат
      const startLabel = start.toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      const endLabel = end.toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      await this.bot.sendMessage(
        chatId,
        `📅 <b>Интенсив на ${days} дней:</b>\n` +
        `• Начало: ${startLabel}\n` +
        `• Окончание: ${endLabel}\n\n` +
        `⏰ Теперь укажи время для каждого дня:`,
        { parse_mode: "HTML" }
      );

      // запускаем ввод времени
      this.intensiveTimes[chatId] = [];
      this.intensiveCurrentDay[chatId] = 0;
      this.steps[chatId] = "intensive_time";

      return this.askIntensiveTime(chatId);
    }

    // ==============================
    // ✅ ОБЫЧНЫЕ ГРУППЫ
    // ==============================

    this.steps[chatId] = "schedule_builder";
    this.scheduleDraft[chatId] = [];

    await this.askDay(chatId);
  }



  // -----------------------------
  // SCHEDULE BUILDER (для групп и открытых групп)
  // -----------------------------
  async askDay(chatId: number) {
    await this.bot.sendMessage(chatId, "🗓 Выбери день недели:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Пн", callback_data: "day_mon" },
            { text: "Вт", callback_data: "day_tue" },
            { text: "Ср", callback_data: "day_wed" },
          ],
          [
            { text: "Чт", callback_data: "day_thu" },
            { text: "Пт", callback_data: "day_fri" },
            { text: "Сб", callback_data: "day_sat" },
          ],
          [{ text: "Вс", callback_data: "day_sun" }],
          [{ text: "✅ Завершить расписание", callback_data: "schedule_done" }],
          [{ text: "❌ Отмена", callback_data: "add_cancel" }],
        ],
      },
    });
  }

  async askTime(chatId: number, day: string) {
    this.tempDay[chatId] = day;
    await this.bot.sendMessage(chatId, `⏰ Время для <b>${day}</b>:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "18:00", callback_data: "time_18" }],
          [{ text: "19:00", callback_data: "time_19" }],
          [{ text: "20:00", callback_data: "time_20" }],
          [{ text: "✍️ Другое", callback_data: "time_manual" }],
          [{ text: "❌ Отмена", callback_data: "add_cancel" }],
        ],
      },
    });
  }
  async askDurationForDay(chatId: number) {
    await this.bot.sendMessage(
      chatId,
      "🕘 Выбери длительность занятия для этого дня:",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "1 час (60 мин)", callback_data: "duration_60" }],
            [{ text: "1,5 часа (90 мин)", callback_data: "duration_90" }],
            [{ text: "2 часа (120 мин)", callback_data: "duration_120" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  // async addSchedule(chatId: number, time: string) {
  //   const day = this.tempDay[chatId];
  //   const duration = this.drafts[chatId].duration_minutes || 90;
  //   const timeRange = addDuration(time, duration);
  //   const entry = `${day} ${timeRange}`;

  //   // Инициализируем массив, если нужно
  //   if (!this.scheduleDraft[chatId]) {
  //     this.scheduleDraft[chatId] = [];
  //   }

  //   this.scheduleDraft[chatId].push(entry);

  //   await this.bot.sendMessage(
  //     chatId,
  //     `✅ Добавлено: <b>${entry}</b>\nДобавим ещё?`,
  //     {
  //       parse_mode: "HTML",
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: "➕ Добавить день", callback_data: "schedule_add_more" }],
  //           [{ text: "✅ Готово", callback_data: "schedule_done" }],
  //         ],
  //       },
  //     }
  //   );
  // }

  async addSchedule(chatId: number, time: string, duration?: number) {
    const day = this.tempDay[chatId];

    // Если длительность не передана, спрашиваем
    if (!duration) {
      this.tempTime[chatId] = time;
      this.steps[chatId] = "waiting_duration";
      await this.askDurationForDay(chatId);
      return;
    }

    const timeRange = addDuration(time, duration);
    const entry = `${day} ${timeRange} (${duration} мин)`;

    // Инициализируем массивы
    if (!this.scheduleDraft[chatId]) {
      this.scheduleDraft[chatId] = [];
    }
    if (!this.scheduleDetails[chatId]) {
      this.scheduleDetails[chatId] = [];
    }

    this.scheduleDraft[chatId].push(entry);
    this.scheduleDetails[chatId].push({ day, time, duration });

    await this.bot.sendMessage(
      chatId,
      `✅ Добавлено: <b>${entry}</b>\nДобавим ещё?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Добавить день", callback_data: "schedule_add_more" }],
            [{ text: "✅ Готово", callback_data: "schedule_done" }],
          ],
        },
      }
    );
  }


  async finishSchedule(chatId: number) {
    if (!this.scheduleDraft[chatId]?.length) {
      await this.bot.sendMessage(chatId, "⚠️ Добавь хотя бы один день.");
      return;
    }

    this.drafts[chatId].schedule = this.formatSchedule(
      this.scheduleDraft[chatId]
    );

    // Сохраняем детальную информацию для создания сессий
    this.drafts[chatId].scheduleDetails = this.scheduleDetails[chatId];

    // дальше → цена за цикл
    this.steps[chatId] = "price";
    await this.bot.sendMessage(
      chatId,
      "💰 Введи цену курса (например 6000):",
      { reply_markup: this.cancelKeyboard() }
    );
  }

  // -----------------------------
  // ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ: ВЫБОР ДНЕЙ
  // -----------------------------
  async askIndividualDays(chatId: number) {
    await this.bot.sendMessage(chatId,
      "🗓 <b>Выбери дни недели, когда доступны индивидуальные занятия:</b>\n\n" +
      "Можно выбрать несколько дней",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Пн", callback_data: "ind_day_mon" },
              { text: "Вт", callback_data: "ind_day_tue" },
              { text: "Ср", callback_data: "ind_day_wed" },
            ],
            [
              { text: "Чт", callback_data: "ind_day_thu" },
              { text: "Пт", callback_data: "ind_day_fri" },
              { text: "Сб", callback_data: "ind_day_sat" },
            ],
            [
              { text: "Вс", callback_data: "ind_day_sun" },
              { text: "✅ Выбрано", callback_data: "ind_days_done" }
            ],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  async handleIndividualDay(chatId: number, data: string) {
    // Маппинг callback -> день
    const daysMap: Record<string, string> = {
      "ind_day_mon": "Пн",
      "ind_day_tue": "Вт",
      "ind_day_wed": "Ср",
      "ind_day_thu": "Чт",
      "ind_day_fri": "Пт",
      "ind_day_sat": "Сб",
      "ind_day_sun": "Вс"
    };

    const day = daysMap[data];

    // Инициализируем массив, если нужно
    if (!this.scheduleDraft[chatId]) {
      this.scheduleDraft[chatId] = [];
    }

    // Проверяем, есть ли уже этот день в расписании
    const existingEntry = this.scheduleDraft[chatId].find(entry =>
      entry.startsWith(day)
    );

    if (existingEntry) {
      // Удаляем день из расписания (отмена выбора)
      this.scheduleDraft[chatId] = this.scheduleDraft[chatId].filter(
        entry => !entry.startsWith(day)
      );
      await this.bot.sendMessage(
        chatId,
        `❌ <b>${day}</b> удалён из расписания`,
        { parse_mode: "HTML" }
      );
    } else {
      // Добавляем день (пока без времени)
      this.scheduleDraft[chatId].push(day);
      await this.bot.sendMessage(
        chatId,
        `✅ <b>${day}</b> добавлен в расписание`,
        { parse_mode: "HTML" }
      );
    }

    // Показываем текущее состояние
    const selectedDays = this.scheduleDraft[chatId].join(", ") || "не выбрано";
    await this.bot.sendMessage(
      chatId,
      `📋 <b>Выбранные дни:</b> ${selectedDays}\n\n` +
      `Продолжайте выбирать дни или нажмите "✅ Выбрано"`,
      { parse_mode: "HTML" }
    );

    // Снова показываем меню выбора дней
    setTimeout(() => this.askIndividualDays(chatId), 500);
  }

  async askIndividualTime(chatId: number) {
    const selectedDays = this.scheduleDraft[chatId];

    if (!selectedDays || selectedDays.length === 0) {
      await this.bot.sendMessage(chatId, "❌ Нужно выбрать хотя бы один день");
      return this.askIndividualDays(chatId);
    }

    // Сохраняем выбранные дни
    this.tempDays = [...selectedDays];
    this.currentDayIndex = 0;

    // Переходим к вводу времени для первого дня
    this.steps[chatId] = "individual_time";
    await this.askTimeForCurrentDay(chatId);
  }

  async askTimeForCurrentDay(chatId: number) {
    const day = this.tempDays[this.currentDayIndex];
    this.tempDay[chatId] = day;

    await this.bot.sendMessage(
      chatId,
      `⏰ <b>Укажи время для ${day}:</b>\n\n` +
      `Пример: 19:00 или 20:30\n` +
      `Это время начала индивидуального занятия`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "18:00", callback_data: "ind_time_18" },
              { text: "19:00", callback_data: "ind_time_19" },
            ],
            [
              { text: "20:00", callback_data: "ind_time_20" },
              { text: "21:00", callback_data: "ind_time_21" },
            ],
            [
              { text: "✍️ Ввести вручную", callback_data: "ind_time_manual" }
            ],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  // В методе saveIndividualTime добавьте обновление шага:
  async saveIndividualTime(chatId: number, time: string) {
    if (!this.tempDay[chatId] || this.currentDayIndex >= this.tempDays.length) {
      console.log("⚠️ Нет текущего дня для сохранения времени");
      await this.bot.sendMessage(chatId, "❌ Ошибка: не выбран день для ввода времени");
      return;
    }

    const day = this.tempDay[chatId];
    const currentIndex = this.currentDayIndex;

    // Валидация времени
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(time)) {
      await this.bot.sendMessage(
        chatId,
        "❌ Неправильный формат времени. Пример: 19:00 или 09:30"
      );
      return;
    }

    // Формируем запись: "Пн 19:00–20:30"
    const duration = this.drafts[chatId].duration_minutes || 90;
    const timeRange = addDuration(time, duration);
    const entry = `${day} ${timeRange}`;

    // Заменяем день на полную запись с временем
    if (this.scheduleDraft[chatId]) {
      // Находим индекс дня без времени
      const dayIndex = this.scheduleDraft[chatId].findIndex(d => d === day);
      if (dayIndex !== -1) {
        this.scheduleDraft[chatId][dayIndex] = entry;
      }
    }

    await this.bot.sendMessage(
      chatId,
      `✅ Время для ${day} сохранено: ${entry}`
    );

    // Переходим к следующему дню
    this.currentDayIndex++;

    // Если есть еще дни, спрашиваем время для следующего
    if (this.currentDayIndex < this.tempDays.length) {
      // 🔥 ВАЖНО: обновляем шаг перед запросом времени для следующего дня
      this.steps[chatId] = "individual_time";
      setTimeout(() => this.askTimeForCurrentDay(chatId), 500);
    } else {
      // Все дни заполнены - переходим к названию
      this.finishIndividualSchedule(chatId);
    }
  }

  async finishIndividualSchedule(chatId: number) {
    const schedule = this.scheduleDraft[chatId].join(", ");
    this.drafts[chatId].schedule = schedule;

    // Автоматическое название для индивидуальных занятий
    this.drafts[chatId].title = "Индивидуальное занятие с Аней";

    // Автоматическое описание
    this.drafts[chatId].description =
      "🎯 <b>Отличная возможность улучшить свои навыки!</b>\n\n" +
      "• Персональный подход и внимание к деталям\n" +
      "• Работа над техникой и выразительностью\n" +
      "• Подбор материала по вашим целям\n" +
      "• Гибкое расписание и удобное время\n\n" +
      "Идеально подходит для тех, кто хочет:\n" +
      "• Быстро прогрессировать в танце\n" +
      "• Подготовиться к выступлению или конкурсу\n" +
      "• Проработать сложные элементы\n" +
      "• Получить индивидуальную обратную связь";

    // Переходим к цене
    this.steps[chatId] = "price";

    await this.bot.sendMessage(
      chatId,
      `📋 <b>Расписание создано:</b>\n${schedule}\n\n` +
      `💰 <b>Теперь установите цену за индивидуальное занятие:</b>`,
      {
        parse_mode: "HTML",
        reply_markup: this.cancelKeyboard()
      }
    );
  }

  // -----------------------------
  // PRICE (цикл)
  // -----------------------------
  async setPrice(chatId: number, text: string) {
    const price = Number(text);
    if (isNaN(price) || price <= 0) {
      await this.bot.sendMessage(chatId, "❌ Цена должна быть положительным числом.");
      return;
    }

    this.drafts[chatId].price = price;

    // если open_group → спросим разовую цену
    if (this.drafts[chatId].type === "open_group") {
      this.steps[chatId] = "single_price";
      await this.bot.sendMessage(
        chatId,
        "💳 Теперь введи цену разового занятия:",
        { reply_markup: this.cancelKeyboard() }
      );
      return;
    }

    // если individual → автоматически заполняем остальные поля
    if (this.drafts[chatId].type === "individual") {
      // Максимум участников для индивидуальных - всегда 1
      this.drafts[chatId].max_participants = 1;

      // Разовая цена = цене курса (для индивидуальных это одно и то же)
      this.drafts[chatId].single_price = price;

      // Показываем превью
      this.steps[chatId] = "confirm";
      await this.showPreview(chatId);
      return;
    }

    // иначе сразу max
    this.steps[chatId] = "max_participants";
    await this.bot.sendMessage(chatId, "👥 Максимум участников?", {
      reply_markup: this.cancelKeyboard(),
    });
  }

  // -----------------------------
  // SINGLE PRICE (разовое)
  // -----------------------------
  async setSinglePrice(chatId: number, text: string) {
    const price = Number(text);
    if (isNaN(price) || price <= 0) {
      await this.bot.sendMessage(chatId, "❌ Введите положительное число.");
      return;
    }

    this.drafts[chatId].single_price = price;
    this.steps[chatId] = "max_participants";
    await this.bot.sendMessage(chatId, "👥 Максимум участников?", {
      reply_markup: this.cancelKeyboard(),
    });
  }

  // -----------------------------
  // MAX PARTICIPANTS
  // -----------------------------
  async setMax(chatId: number, text: string) {
    const max = Number(text);
    if (isNaN(max) || max <= 0) {
      await this.bot.sendMessage(chatId, "❌ Введите положительное число.");
      return;
    }

    this.drafts[chatId].max_participants = max;

    // Для индивидуальных занятий ссылка не нужна
    if (this.drafts[chatId].type === "individual") {
      this.steps[chatId] = "confirm";
      await this.showPreview(chatId);
    } else {
      this.steps[chatId] = "group_link";
      await this.askGroupLink(chatId);
    }
  }

  // -----------------------------
  // PREVIEW
  // -----------------------------
  async showPreview(chatId: number) {
    const draft = this.drafts[chatId];

    // ⏱ Красиво показываем длительность
    const durationText =
      draft.duration_minutes === 60
        ? "1 час"
        : draft.duration_minutes === 90
          ? "1,5 часа"
          : draft.duration_minutes === 120
            ? "2 часа"
          : `${draft.duration_minutes} мин`;

    let msg = "";

    // Разное форматирование для разных типов
    if (draft.type === "individual") {
      msg =
        `👤 <b>ИНДИВИДУАЛЬНОЕ ЗАНЯТИЕ</b>\n\n` +
        `💃 <b>${draft.title}</b>\n` +
        `📌 ${draft.description}\n\n` +
        `📅 <b>Доступное время:</b>\n` +
        `⏰ ${draft.schedule}\n` +
        `⏱ Длительность: <b>${durationText}</b>\n\n` +
        `💰 Цена: <b>${draft.price} ₽</b>\n` +
        `👥 Места: <b>${draft.max_participants}</b> (индивидуальное)\n\n` +
        `Создать занятие?`;
    } else if (draft.type === "intensive" && this.intensiveTimes[chatId]) {
      const [year, month, day] = draft.start_date!.split("-").map(Number);
      const startDate = new Date(year, month - 1, day);

      if (draft.group_link) {
        msg += `🔗 <a href="${draft.group_link}">Ссылка на чат группы</a>\n`;
      }

      msg =
        `💃 <b>${draft.title}</b>\n` +
        `📌 ${draft.description}\n\n` +
        `📅 Старт: <b>${draft.start_date}</b>\n`;

      msg += `📆 <b>Расписание интенсива:</b>\n`;
      for (let i = 0; i < this.intensiveDays[chatId]; i++) {
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + i);
        const dayLabel = dayDate.toLocaleDateString("ru-RU", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        const timeForDay = this.intensiveTimes[chatId][i] || "не указано";
        msg += `• ${dayLabel} — <b>${timeForDay}</b>\n`;
      }

      msg += `⏱ Длительность: <b>${durationText}</b>\n` +
        `💰 Цена курса: <b>${draft.price} ₽</b>\n` +
        `👥 Места: <b>${draft.max_participants}</b>\n\n` +
        `Создать занятие?`;
    } else {
      msg =
        `💃 <b>${draft.title}</b>\n` +
        `📌 ${draft.description}\n\n` +
        `📅 Старт: <b>${draft.start_date}</b>\n` +
        `⏰ ${draft.schedule}\n` +
        `⏱ Длительность: <b>${durationText}</b>\n\n` +
        `💰 Цена курса: <b>${draft.price} ₽</b>\n`;

      if (draft.single_price) {
        msg += `💳 Разовое: <b>${draft.single_price} ₽</b>\n`;
      }

      msg += `👥 Места: <b>${draft.max_participants}</b>\n\nСоздать занятие?`;
    }

    await this.bot.sendMessage(chatId, msg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Создать", callback_data: "add_confirm" }],
          [{ text: "❌ Отмена", callback_data: "add_cancel" }],
        ],
      },
    });
  }

  // -----------------------------
  // CONFIRM
  // -----------------------------
  async confirm(chatId: number) {
    const draft = this.drafts[chatId];

    if (!draft || !draft.type || !draft.title || draft.price === undefined) {
      await this.bot.sendMessage(
        chatId,
        "❌ Данные программы потеряны (возможно, бот перезагрузился). Пожалуйста, создайте занятие заново.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Создать заново", callback_data: "admin_add_program" }],
              [{ text: "🏠 В админку", callback_data: "admin_panel" }],
            ],
          },
        }
      );
      this.cancel(chatId);
      return;
    }

    // Сохраняем scheduleDetails отдельно для создания сессий
    const scheduleDetails = draft.scheduleDetails;

    // Создаём копию черновика без scheduleDetails для сохранения в БД
    const { scheduleDetails: _, ...programData } = draft;

    // 1) создаём программу (без scheduleDetails)
    const created = await this.programService.createProgram(programData);

    // 2) если это open_group → генерируем реальные занятия
    if (draft.type === "open_group" && draft.start_date && draft.schedule) {
      const sessions = generateSessions(draft.start_date, draft.schedule);
      await this.programService.createSessions(created.id, sessions);
    }

    // 3) если это интенсив → создаём сессии для каждого дня
    if (draft.type === "intensive" && draft.start_date && draft.end_date) {
      const days = this.intensiveDays[chatId];
      const times = this.intensiveTimes[chatId];
      const sessions = [];

      for (let i = 0; i < days; i++) {
        const d = new Date(draft.start_date!);
        d.setDate(d.getDate() + i);
        sessions.push({
          date: d.toISOString().split("T")[0],
          time: times[i],
          duration_minutes: draft.duration_minutes,
        });
      }

      await this.programService.createSessions(created.id, sessions);
    }

    // 4) для открытых групп с детальным расписанием (разная длительность)
    if (draft.type === "open_group" && draft.start_date && scheduleDetails && scheduleDetails.length > 0) {
      const sessions = [];
      const startDate = new Date(draft.start_date);

      // Для каждого дня создаём сессии на 4 недели вперёд
      for (let week = 0; week < 4; week++) {
        for (const entry of scheduleDetails) {
          // Вычисляем дату для конкретного дня недели
          const sessionDate = this.getNextDateForDay(startDate, entry.day, week);
          if (sessionDate) {
            sessions.push({
              date: sessionDate.toISOString().split('T')[0],
              time: entry.time,
              duration_minutes: entry.duration
            });
          }
        }
      }

      await this.programService.createSessions(created.id, sessions);
    }

    // 5) для индивидуальных занятий не создаем фиксированные сессии
    if (draft.type === "individual") {
      console.log(`✅ Индивидуальное занятие создано без фиксированных сессий`);
    }

    // очищаем черновик
    delete this.drafts[chatId];
    delete this.steps[chatId];
    delete this.scheduleDraft[chatId];
    delete this.scheduleDetails[chatId];
    delete this.intensiveDays[chatId];
    delete this.intensiveTimes[chatId];
    delete this.intensiveCurrentDay[chatId];
    this.tempDays = [];
    this.currentDayIndex = 0;

    await this.bot.sendMessage(chatId, "🎉 Занятие создано!", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Добавить ещё", callback_data: "admin_add_program" }],
          [{ text: "🏠 В админку", callback_data: "admin_panel" }],
        ],
      },
    });
  }

  // -----------------------------
  // CANCEL
  // -----------------------------
  async cancel(chatId: number) {
    delete this.drafts[chatId];
    delete this.steps[chatId];
    delete this.scheduleDraft[chatId];
    delete this.intensiveDays[chatId];
    delete this.intensiveTimes[chatId];
    delete this.intensiveCurrentDay[chatId];
    this.tempDays = [];
    this.currentDayIndex = 0;

    await this.bot.sendMessage(chatId, "❌ Создание отменено.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Добавить ещё", callback_data: "admin_add_program" }],
          [{ text: "🏠 В админку", callback_data: "admin_panel" }],
        ],
      },
    });
  }

  // -----------------------------
  // TEXT INPUT
  // -----------------------------
  async handleText(chatId: number, text: string) {
    const step = this.steps[chatId];
    if (!step) return false;

    switch (step) {
      case "title":
        await this.setTitle(chatId, text);
        break;
      case "description":
        await this.setDescription(chatId, text);
        break;
      case "start_date_manual":
        await this.setStartDate(chatId, text);
        break;
      case "time_manual":
        await this.addSchedule(chatId, text);
        break;
      // В методе handleText:
      case "ind_time_manual":
        // 🔥 Важно: проверяем, что мы все еще в процессе ввода времени для индивидуальных
        if (this.steps[chatId] === "ind_time_manual") {
          await this.saveIndividualTime(chatId, text);
        } else {
          // Если шаг изменился, возможно это повторный ввод - все равно пытаемся сохранить
          await this.saveIndividualTime(chatId, text);
        }
        break;
      case "price":
        await this.setPrice(chatId, text);
        break;
      case "single_price":
        await this.setSinglePrice(chatId, text);
        break;
      case "max_participants":
        await this.setMax(chatId, text);
        break;
      case "intensive_days_manual":
        const days = Number(text);
        if (isNaN(days) || days <= 0 || days > 30) {
          await this.bot.sendMessage(chatId, "❌ Введите корректное число (1-30).");
          return true;
        }
        this.intensiveDays[chatId] = days;
        // ✅ Не перезаписываем черновик!
        if (!this.drafts[chatId]) {
          this.drafts[chatId] = {};
        }
        this.drafts[chatId].type = "intensive";
        // this.drafts[chatId].duration_minutes = 90;
        this.steps[chatId] = "title";
        await this.bot.sendMessage(chatId, "✏️ Напиши название интенсива:", {
          reply_markup: this.cancelKeyboard(),
        });
        break;
      case "intensive_time_manual":
        await this.saveIntensiveTime(chatId, text);
        break;
      
      case "group_link":
        if (text === "-") {
          this.drafts[chatId].group_link = null;
        } else {
          // базовая проверка, что похоже на ссылку (не обязательно)
          if (!text.startsWith('http')) {
            await this.bot.sendMessage(chatId, "❌ Ссылка должна начинаться с http:// или https://. Отправь '-' чтобы пропустить.");
            return true;
          }
          this.drafts[chatId].group_link = text;
        }
        this.steps[chatId] = "confirm";
        await this.showPreview(chatId);
        break;
      default:
        return false;
    }

    return true;
  }

  // -----------------------------
  // CALLBACK HANDLER
  // -----------------------------
  async handleCallback(chatId: number, data: string) {
    console.log(`🔄 AdminAddProgramHandler.handleCallback: chatId=${chatId}, data=${data}, currentStep=${this.steps[chatId]}`);

    // 🔥 КРИТИЧЕСКИ ВАЖНО: обработка времени интенсива ДОЛЖНА БЫТЬ В САМОМ НАЧАЛЕ!
    if (this.steps[chatId] === "intensive_time") {
      console.log(`⏰ Обработка времени для интенсива, день ${this.intensiveCurrentDay[chatId] + 1} из ${this.intensiveDays[chatId]}`);

      const intTimeMap: Record<string, string> = {
        int_time_18: "18:00",
        int_time_19: "19:00",
        int_time_1930: "19:30",
        int_time_20: "20:00",
        int_time_2030: "20:30",
        int_time_21: "21:00",
        int_time_2130: "21:30",
      };

      if (intTimeMap[data]) {
        console.log(`⏱ Выбрано время: ${intTimeMap[data]}`);
        await this.saveIntensiveTime(chatId, intTimeMap[data]);
        return;
      }

      if (data === "int_time_manual") {
        this.steps[chatId] = "intensive_time_manual";
        await this.bot.sendMessage(chatId, "✍️ Введите время (например 19:30):");
        return;
      }
    }

    // 🔥 Обработка времени для индивидуальных занятий
    if (this.steps[chatId] === "individual_time" || this.steps[chatId] === "ind_time_manual") {
      const indTimeMap: Record<string, string> = {
        ind_time_18: "18:00",
        ind_time_19: "19:00",
        ind_time_20: "20:00",
        ind_time_21: "21:00"
      };

      if (indTimeMap[data]) {
        await this.saveIndividualTime(chatId, indTimeMap[data]);
        return;
      }

      if (data === "ind_time_manual") {
        // Если уже в режиме ручного ввода, просто игнорируем
        if (this.steps[chatId] === "ind_time_manual") {
          console.log("⚠️ Уже в режиме ind_time_manual, игнорируем повторный колбэк");
          return;
        }

        this.steps[chatId] = "ind_time_manual";
        await this.bot.sendMessage(chatId, "✍️ Введите время (например 19:30):");
        return;
      }
    }
    // В методе handleCallback после обработки времени
    if (data === "time_choose_duration") {
      this.steps[chatId] = "waiting_duration";
      await this.askDurationForDay(chatId);
      return;
    }

    // Обработка выбора длительности
    if (data.startsWith("duration_") && this.steps[chatId] === "waiting_duration") {
      const duration = parseInt(data.replace("duration_", ""));
      const time = this.tempTime[chatId];
      await this.addSchedule(chatId, time, duration);
      return;
    }

    // 🔥 Обработка выбора типа занятия
    if (data.startsWith("add_type_")) {
      const type = data.replace("add_type_", "");
      console.log(`🎯 Выбран тип: ${type}`);
      await this.setType(chatId, type);
      return;
    }

    // ⏱ Админ выбрал длительность занятия
    // if (data.startsWith("duration_")) {
    //   const minutes = Number(data.replace("duration_", ""));

    //   // ✅ гарантируем существование черновика
    //   if (!this.drafts[chatId]) {
    //     this.drafts[chatId] = {};
    //   }

    //   this.drafts[chatId].duration_minutes = minutes;
    //   this.steps[chatId] = "individual_schedule";

    //   await this.bot.sendMessage(
    //     chatId,
    //     `✅ Длительность установлена: ${minutes} минут (${minutes === 60 ? '1 час' : '1,5 часа'})`
    //   );

    //   // Очищаем предыдущее расписание и начинаем заново
    //   this.scheduleDraft[chatId] = [];
    //   this.tempDay[chatId] = "";

    //   // Переходим к выбору дней недели
    //   await this.askIndividualDays(chatId);
    //   return;
    // }

    if (data.startsWith("duration_")) {
      const minutes = Number(data.replace("duration_", ""));

      this.drafts[chatId].duration_minutes = minutes;

      let durationText = `${minutes} мин`;

      if (minutes === 60) durationText = "1 час";
      if (minutes === 90) durationText = "1,5 часа";
      if (minutes === 120) durationText = "2 часа";

      await this.bot.sendMessage(
        chatId,
        `✅ Длительность установлена: ${durationText}`
      );

      // дальше зависит от типа
      const type = this.drafts[chatId].type;

      if (type === "intensive") {
        this.steps[chatId] = "intensive_days";
        return this.askIntensiveDays(chatId);
      }

      if (type === "individual") {
        return this.askIndividualDays(chatId);
      }

      // обычные группы → дальше название
      this.steps[chatId] = "title";
      return this.bot.sendMessage(chatId, "✏️ Напиши название занятия:", {
        reply_markup: this.cancelKeyboard(),
      });
    }


    // 🔥 Обработка дней для индивидуальных занятий
    if (data.startsWith("ind_day_")) {
      await this.handleIndividualDay(chatId, data);
      return;
    }

    if (data === "ind_days_done") {
      await this.askIndividualTime(chatId);
      return;
    }

    // даты
    if (data === "add_date_today") return this.setStartDate(chatId, this.formatDate(0));
    if (data === "add_date_tomorrow") return this.setStartDate(chatId, this.formatDate(1));
    if (data === "add_date_week") return this.setStartDate(chatId, this.formatDate(7));
    if (data === "add_date_manual") {
      this.steps[chatId] = "start_date_manual";
      await this.bot.sendMessage(chatId, "✍️ Введите дату: дд.мм.гг");
      return;
    }

    // дни недели (для групп и открытых групп)
    const daysMap: Record<string, string> = {
      day_mon: "Пн",
      day_tue: "Вт",
      day_wed: "Ср",
      day_thu: "Чт",
      day_fri: "Пт",
      day_sat: "Сб",
      day_sun: "Вс",
    };

    if (daysMap[data]) return this.askTime(chatId, daysMap[data]);

    // время (для групп и открытых групп)
    const timeMap: Record<string, string> = {
      time_18: "18:00",
      time_19: "19:00",
      time_20: "20:00",
    };

    if (timeMap[data]) return this.addSchedule(chatId, timeMap[data]);
    if (data === "time_manual") {
      this.steps[chatId] = "time_manual";
      await this.bot.sendMessage(chatId, "✍️ Введите время (например 19:30):");
      return;
    }
    if (data === "schedule_add_more") return this.askDay(chatId);
    if (data === "schedule_done") return this.finishSchedule(chatId);
    if (data === "add_confirm") return this.confirm(chatId);
    if (data === "add_cancel") return this.cancel(chatId);

    // интенсив количество дней
    if (data === "intensive_days_manual") {
      this.steps[chatId] = "intensive_days_manual";
      await this.bot.sendMessage(chatId, "✍️ Введите число дней (например 3):");
      return;
    }

    if (data === "group_link_skip") {
      this.drafts[chatId].group_link = null;
      this.steps[chatId] = "confirm";
      await this.showPreview(chatId);
      return;
    }

    // выбор количества дней интенсива
    if (data.startsWith("intensive_days_")) {
      const days = parseInt(data.replace("intensive_days_", ""));
      if (!isNaN(days) && days > 0 && days <= 30) {
        // ✅ сохраняем дни
        this.intensiveDays[chatId] = days;
        // ✅ Не перезаписываем черновик!
        if (!this.drafts[chatId]) {
          this.drafts[chatId] = {};
        }
        this.drafts[chatId].type = "intensive";
        // this.drafts[chatId].duration_minutes = 90;
        // дальше продолжаем flow
        this.steps[chatId] = "title";
        await this.bot.sendMessage(
          chatId,
          "✏️ Напиши название интенсива:",
          { reply_markup: this.cancelKeyboard() }
        );
        return;
      }
    }

    // Если дошли сюда и не обработали колбэк
    console.log(`⚠️ Необработанный колбэк в AdminAddProgramHandler: ${data}`);
  }

  // -----------------------------
  // ИНТЕНСИВ: ВЫБОР КОЛИЧЕСТВА ДНЕЙ
  // -----------------------------
  async askIntensiveDays(chatId: number) {
    await this.bot.sendMessage(
      chatId,
      "🔥 Сколько дней длится интенсив?",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "2 дня", callback_data: "intensive_days_2" },
              { text: "3 дня", callback_data: "intensive_days_3" },
            ],
            [
              { text: "4 дня", callback_data: "intensive_days_4" },
              { text: "5 дней", callback_data: "intensive_days_5" },
            ],
            [
              { text: "6 дней", callback_data: "intensive_days_6" },
              { text: "7 дней", callback_data: "intensive_days_7" },
            ],
            [{ text: "✍️ Ввести вручную", callback_data: "intensive_days_manual" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  // -----------------------------
  // ИНТЕНСИВ: ВЫБОР ВРЕМЕНИ ДЛЯ КАЖДОГО ДНЯ
  // -----------------------------
  async askIntensiveTime(chatId: number) {
    const dayIndex = this.intensiveCurrentDay[chatId] || 0;
    const totalDays = this.intensiveDays[chatId] || 0;

    if (!this.drafts[chatId]?.start_date) {
      await this.bot.sendMessage(chatId, "❌ Ошибка: дата начала не указана");
      return;
    }

    const [y, m, d] = this.drafts[chatId].start_date!.split("-").map(Number);
    const startDate = new Date(y, m - 1, d);
    const sessionDate = new Date(startDate);
    sessionDate.setDate(startDate.getDate() + dayIndex);

    const label = sessionDate.toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    await this.bot.sendMessage(
      chatId,
      `⏰ <b>День ${dayIndex + 1} из ${totalDays}</b>\n` +
      `📅 Дата: ${label}\n` +
      `Выберите время начала занятия:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "18:00", callback_data: "int_time_18" }],
            [{ text: "19:00", callback_data: "int_time_19" }],
            [{ text: "19:30", callback_data: "int_time_1930" }],
            [{ text: "20:00", callback_data: "int_time_20" }],
            [{ text: "20:30", callback_data: "int_time_2030" }],
            [{ text: "21:00", callback_data: "int_time_21" }],
            [{ text: "21:30", callback_data: "int_time_2130" }],
            [{ text: "✍️ Ввести вручную", callback_data: "int_time_manual" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  // -----------------------------
  // ИНТЕНСИВ: СОХРАНЕНИЕ ВРЕМЕНИ И ПЕРЕХОД К СЛЕДУЮЩЕМУ ДНЮ
  // -----------------------------
  async saveIntensiveTime(chatId: number, time: string) {
    console.log("🔥 saveIntensiveTime:", chatId, time);
    console.log("📅 Текущий день:", this.intensiveCurrentDay[chatId]);
    console.log("📅 Всего дней:", this.intensiveDays[chatId]);

    // ✅ гарантируем массив
    if (!this.intensiveTimes[chatId]) {
      this.intensiveTimes[chatId] = [];
    }

    // ✅ гарантируем текущий индекс
    if (this.intensiveCurrentDay[chatId] === undefined) {
      this.intensiveCurrentDay[chatId] = 0;
    }

    // ✅ гарантируем количество дней
    const totalDays = this.intensiveDays[chatId];
    if (!totalDays || totalDays <= 0) {
      await this.bot.sendMessage(
        chatId,
        "❌ Ошибка: не задано количество дней интенсива."
      );
      return;
    }

    // какой день сейчас
    const index = this.intensiveCurrentDay[chatId];

    // Проверяем формат времени
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(time)) {
      await this.bot.sendMessage(
        chatId,
        "❌ Неправильный формат времени. Пример: 19:00 или 09:30"
      );
      return;
    }

    // сохраняем время для текущего дня
    this.intensiveTimes[chatId].push(time);

    // Вычисляем дату для текущего дня
    const [y, m, d] = this.drafts[chatId].start_date!.split("-").map(Number);
    const startDate = new Date(y, m - 1, d);
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + index);

    // Форматируем дату для отображения
    const dateLabel = currentDate.toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    await this.bot.sendMessage(
      chatId,
      `✅ День ${index + 1} (${dateLabel}) — время ${time} сохранено!`
    );

    // увеличиваем день
    this.intensiveCurrentDay[chatId]++;

    console.log("📝 После увеличения:", {
      currentDay: this.intensiveCurrentDay[chatId],
      totalDays,
      intensiveTimes: this.intensiveTimes[chatId],
    });

    // ✅ если ещё есть дни → спрашиваем дальше БЕЗ задержки
    if (this.intensiveCurrentDay[chatId] < totalDays) {
      console.log(`➡️ Переходим к дню ${this.intensiveCurrentDay[chatId] + 1} из ${totalDays}`);
      await this.askIntensiveTime(chatId); // ✅ прямой вызов без setTimeout!
      return;
    }

    // ✅ все дни заполнены → собираем расписание и переходим к цене
    console.log("🎉 Все дни заполнены!");
    console.log("⏰ Сохраненные времена:", this.intensiveTimes[chatId]);

    // Создаем расписание в виде текста для отображения
    let scheduleText = "📆 <b>Расписание интенсива:</b>\n";
    for (let i = 0; i < totalDays; i++) {
      const dayDate = new Date(startDate);
      dayDate.setDate(startDate.getDate() + i);
      const dayLabel = dayDate.toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const timeForDay = this.intensiveTimes[chatId][i] || "не указано";
      scheduleText += `• ${dayLabel} — <b>${timeForDay}</b>\n`;
    }

    // Сохраняем schedule
    this.drafts[chatId].schedule = scheduleText;

    // Переходим к следующему шагу - цена
    this.steps[chatId] = "price";
    console.log("💰 Переходим к вводу цены");

    await this.bot.sendMessage(
      chatId,
      `${scheduleText}\n💰 Теперь введи цену интенсива:`,
      {
        parse_mode: "HTML",
        reply_markup: this.cancelKeyboard(),
      }
    );
  }

  async askGroupLink(chatId: number) {
    await this.bot.sendMessage(
      chatId,
      "🔗 Введи ссылку на Telegram-группу для участников (например, https://t.me/joinchat/...)\n" +
      "Если ссылки пока нет, отправь '-' чтобы пропустить.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⏩ Пропустить", callback_data: "group_link_skip" }],
            [{ text: "❌ Отмена", callback_data: "add_cancel" }],
          ],
        },
      }
    );
  }

  private getNextDateForDay(startDate: Date, dayOfWeek: string, weekOffset: number): Date | null {
    const daysMap: Record<string, number> = {
      'Пн': 1, 'Вт': 2, 'Ср': 3, 'Чт': 4, 'Пт': 5, 'Сб': 6, 'Вс': 0
    };

    const targetDay = daysMap[dayOfWeek];
    if (targetDay === undefined) return null;

    const result = new Date(startDate);
    result.setDate(startDate.getDate() + (weekOffset * 7));

    // Находим ближайший целевой день недели
    while (result.getDay() !== targetDay) {
      result.setDate(result.getDate() + 1);
    }

    return result;
  }

}