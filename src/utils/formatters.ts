import { supabase } from "../database/supabase";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString('ru-RU') + ' ₽';
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  // Проверяем, что дата валидна
  if (isNaN(d.getTime())) {
    return 'дата не указана';
  }

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'long'
  };

  return d.toLocaleDateString('ru-RU', options);
}

export function formatDateRange(startDate: string | Date, endDate: string | Date): string {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  if (isNaN(start.getTime())) {
    return 'дата не указана';
  }

  const startStr = start.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });

  if (isNaN(end.getTime())) {
    return `с ${startStr}`;
  }

  const endStr = end.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });

  return `${startStr} — ${endStr}`;
}


export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU');
}

// export function formatProgram(program: any): string {
//   const freeSpots = program.max_participants - program.current_participants;
//   const spotsText = freeSpots > 0
//     ? `(${freeSpots} свободно)`
//     : `(мест нет)`;

//   const typeNames: Record<string, string> = {
//     'group': '👥 Групповые занятия',
//     'intensive': '🔥 Интенсив',
//     'open_group': '🎪 Открытая группа',
//     'individual': '👤 Индивидуальные занятия'
//   };


//   let message = `<b>${escapeHtml(program.title)}</b>\n`;
//   message += `<i>${typeNames[program.type] || program.type}</i>\n\n`;
//   message += `${escapeHtml(program.description || '')}\n\n`;
//   message += `<b>👥 Места:</b> ${program.current_participants}/${program.max_participants} ${spotsText}\n`;

//   if (program.type === 'open_group' && program.single_price) {
//     message += `<b>💰 Стоимость:</b>\n`;
//     message += `• 4 занятия: ${formatCurrency(program.price)}\n`;
//     message += `• Разовое: ${formatCurrency(program.single_price)}\n\n`;
//   } else {
//     message += `<b>💰 Стоимость:</b> ${formatCurrency(program.price)}\n\n`;
//   }

//   if (program.start_date) {
//     message += `<b>📅 Старт:</b> ${formatDate(program.start_date)}`;
//     if (program.end_date) message += ` - ${formatDate(program.end_date)}`;
//     message += '\n';
//   }

//   if (program.schedule) {
//     const duration = program.duration_minutes || 90;

//     // "Вт 20:30, Пт 20:00"
//     const parts = program.schedule.split(",");

//     const formatted = parts.map((entry: string) => {
//       const trimmed = entry.trim();

//       // разделяем: день и время
//       const [day, time] = trimmed.split(" ");

//       if (!time) return trimmed;


//       if (time.includes("–")) {
//         return `${day} ${time}`;
//       }

//       const timeRange = addDuration(time, duration);

//       return `${day} ${timeRange}`;
//     });

//     message += `<b>⏰ Расписание:</b> ${escapeHtml(formatted.join(", "))}\n`;
//   }


//   message += `<b>👥 Места:</b> ${program.current_participants}/${program.max_participants} `;
//   message += `(${freeSpots} свободно)`;

//   return message;
// }

export function formatProgram(program: any): string {
  const freeSpots = program.max_participants - program.current_participants;
  const spotsText = freeSpots > 0 ? `${freeSpots} свободно` : 'мест нет';

  let message = `💃 <b>${escapeHtml(program.title)}</b>\n\n`;

  // Тип программы
  const typeLabels: Record<string, string> = {
    group: '👥 Групповое занятие',
    intensive: '🔥 Интенсив',
    open_group: '🎪 Открытая группа',
    individual: '👤 Индивидуальное занятие'
  };
  message += `<b>${typeLabels[program.type] || 'Занятие'}</b>\n\n`;

  // Описание
  if (program.description) {
    message += `${program.description}\n\n`;
  }

  // Для интенсивов показываем даты и расписание
  if (program.type === 'intensive') {
    // Даты
    if (program.start_date) {
      const startDate = new Date(program.start_date);
      message += `📅 <b>Старт:</b> ${formatDate(startDate)}`;

      if (program.end_date) {
        const endDate = new Date(program.end_date);
        message += ` — ${formatDate(endDate)}`;
      }
      message += '\n';
    }

    // Расписание (пытаемся распарсить)
    if (program.schedule) {
      message += `\n📆 <b>Расписание:</b>\n`;

      // Проверяем, есть ли в расписании строки с тире (признак форматированного текста)
      if (program.schedule.includes('—')) {
        // Если есть тире, значит там уже есть время
        const lines = program.schedule.split('\n');
        lines.forEach(line => {
          if (line.includes('—')) {
            // Убираем HTML теги для чистоты
            const cleanLine = line.replace(/<[^>]*>/g, '');
            message += `${cleanLine}\n`;
          }
        });
      } else {
        // Если нет тире, значит это просто список дат
        // Пытаемся найти время в тексте
        const timeMatch = program.schedule.match(/\d{2}:\d{2}/);
        if (timeMatch) {
          // Если есть время, показываем как есть
          message += `${program.schedule}\n`;
        } else {
          // Если времени нет, добавляем заглушку
          message += `${program.schedule}\n`;
          message += `⏰ Время уточняется\n`;
        }
      }
    }
  } else {
    // Для остальных типов показываем дату старта и расписание
    if (program.start_date) {
      const startDate = new Date(program.start_date);
      message += `📅 <b>Старт:</b> ${formatDate(startDate)}\n`;
    }

    if (program.schedule) {
      message += `⏰ <b>Расписание:</b> ${program.schedule}\n`;
    }
  }

  // Цены
  message += `\n💰 <b>Цена:</b> ${formatCurrency(program.price)} ₽`;
  if (program.single_price) {
    message += `\n💳 <b>Разовое:</b> ${formatCurrency(program.single_price)} ₽`;
  }

  // Места
  message += `\n👥 <b>Места:</b> ${program.current_participants}/${program.max_participants} (${spotsText})`;

  // Ссылка на группу (если есть)
  if (program.group_link) {
    message += `\n\n🔗 <b>Чат группы:</b>\n${program.group_link}`;
  }

  return message;
}

export async function formatApplication(app: any) {

  const userName = escapeHtml(app.user_name || "Без имени");
  const phone = escapeHtml(app.user_phone || "не указан");
  const programTitle = escapeHtml(app.programs?.title || "Программа");

  let bookingType = "";
  let datesText = "";

  // ================================
  // 🎫 Разовое занятие
  // ================================
  if (app.session_id) {
    bookingType = "🎫 <b>Разовое занятие</b>";

    const { data: session } = await supabase
      .from("program_sessions")
      .select("session_date, session_time")
      .eq("id", app.session_id)
      .single();

    if (session) {
      datesText =
        `🗓 <b>Дата занятия:</b> ${formatDate(session.session_date)} — ${escapeHtml(
          session.session_time
        )}`;
    }
  }

  // ================================
  // 📦 Абонемент (4 занятия)
  // ================================
  else if (app.session_ids?.length) {
    bookingType = "📦 <b>Абонемент (4 занятия)</b>";

    const ids = app.session_ids.map((id: any) => Number(id));

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

      datesText =
        `📅 <b>Выбранные даты:</b>\n` +
        sessions
          .map(
            (s) =>
              `• ${formatDate(s.session_date)} — ${escapeHtml(s.session_time)}`
          )
          .join("\n");
    }
  }

  // ================================
  // 📝 Комментарий
  // ================================
  const notes =
    app.user_notes && app.user_notes.trim().length > 0
      ? escapeHtml(app.user_notes)
      : "нет";

  // ================================
  // 💬 Финальный текст
  // ================================
  return (
    `⏳ <b>ЗАЯВКА #${app.id}</b>\n\n` +
    `👤 <b>${userName}</b>\n` +
    `📞 <code>${phone}</code>\n\n` +
    `💃 <b>${programTitle}</b>\n\n` +
    (bookingType ? `${bookingType}\n\n` : "") +
    (datesText ? `${datesText}\n\n` : "") +
    `💰 <b>${formatCurrency(app.amount)}</b>\n` +
    `📝 <b>Комментарий:</b> ${notes}\n\n` +
    `📌 Статус: ⏳ ожидает подтверждения оплаты`
  );
}

export function formatBooking(booking: any): string {
  // Build first line: Name, username (if any), and booking id
  const usernameRaw = booking.users && (booking.users as any).username ? (booking.users as any).username : '';
  const usernamePart = usernameRaw ? ` [@${escapeHtml(usernameRaw)}]` : '';
  const firstLine = `${escapeHtml(booking.user_name)}${usernamePart} [#${booking.id}]`;

  // No attended tracking — always show as booking line without attended icon
  return `${firstLine}\n` +
    `💃 ${booking.programs?.title || 'Неизвестно'}\n` +
    `💰 ${formatCurrency(booking.amount)}\n` +
    `📅 ${formatDate(booking.created_at)}`;
}

// ⏱ Добавляет время окончания по длительности
// export function addDuration(time: string, minutes: number) {
//   const [h, m] = time.split(":").map(Number);

//   const start = new Date();
//   start.setHours(h, m);

//   const end = new Date(start.getTime() + minutes * 60000);

//   const hh = String(end.getHours()).padStart(2, "0");
//   const mm = String(end.getMinutes()).padStart(2, "0");

//   return `${time}–${hh}:${mm}`;
// }


export function addDuration(
  time: string,
  durationMinutes: number
): string {
  if (!time) return "";

  // ✅ Если уже диапазон — ничего не добавляем
  if (time.includes("–") || time.includes("-")) {
    return time;
  }

  // Ожидаем формат "HH:MM"
  const match = time.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    // если формат непонятный — просто возвращаем как есть
    return time;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (isNaN(hours) || isNaN(minutes)) return time;

  // Переводим в минуты
  const startTotal = hours * 60 + minutes;
  const endTotal = startTotal + durationMinutes;

  // Обратно в часы и минуты
  const endHours = Math.floor(endTotal / 60) % 24;
  const endMinutes = endTotal % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  return `${pad(hours)}:${pad(minutes)}–${pad(endHours)}:${pad(endMinutes)}`;
}



// utils/scheduleFormatter.ts
export function formatSchedule(schedule: string): string {
  if (!schedule) return 'Расписание уточняется';

  // Если уже содержит "•", возвращаем как есть
  if (schedule.includes('•')) return schedule;

  // Если разделено запятыми, форматируем
  if (schedule.includes(',')) {
    const days = schedule.split(',').map(day => day.trim());
    return days.map(day => `• ${day}`).join('\n');
  }

  // Если просто строка
  return `• ${schedule}`;
}