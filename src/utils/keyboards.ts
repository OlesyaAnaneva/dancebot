export function generateMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '💃 Записаться', callback_data: 'nav_programs' }],
      // [{ text: '📅 Мои занятия', callback_data: 'nav_schedule' }],
      [{ text: '📅 Мои занятия', callback_data: 'nav_my_bookings' },
      { text: '🗓 Расписание студии', callback_data: 'nav_schedule' }],
      [{ text: 'ℹ️ Информация', callback_data: 'nav_info' }],
      // [{ text: '📍 Студия', callback_data: 'nav_studio' }],
      // [{ text: '📞 Контакты', callback_data: 'nav_contacts' }],
      // [{ text: '👗 Что взять', callback_data: 'nav_equipment' }]
    ]
  };
}

export function generateProgramsKeyboard(programs: any[]) {
  const keyboard = [];

  // Группируем программы по типам
  const byType: Record<string, any[]> = {
    'group': [],
    'intensive': [],
    'open_group': [],
    'individual': []
  };

  programs.forEach(program => {
    if (byType[program.type]) {
      byType[program.type].push(program);
    }
  });

  // Добавляем программы по типам
  if (byType.group.length > 0) {
    keyboard.push([{ text: '👥 ГРУППОВЫЕ', callback_data: 'type_group' }]);
    byType.group.forEach(program => {
      const freeSpots = program.max_participants - program.current_participants;
      const spotsEmoji = freeSpots > 0 ? '✅' : '⏳';
      keyboard.push([{
        text: `${spotsEmoji} ${program.title.substring(0, 25)}...`,
        callback_data: `program_${program.id}`
      }]);
    });
  }

  if (byType.intensive.length > 0) {
    keyboard.push([{ text: '🔥 ИНТЕНСИВЫ', callback_data: 'type_intensive' }]);
    byType.intensive.forEach(program => {
      const freeSpots = program.max_participants - program.current_participants;
      const spotsEmoji = freeSpots > 0 ? '✅' : '⏳';
      keyboard.push([{
        text: `${spotsEmoji} ${program.title.substring(0, 25)}...`,
        callback_data: `program_${program.id}`
      }]);
    });
  }

  if (byType.open_group.length > 0) {
    keyboard.push([{ text: '🎪 ОТКРЫТЫЕ', callback_data: 'type_open' }]);
    byType.open_group.forEach(program => {
      const freeSpots = program.max_participants - program.current_participants;
      const spotsEmoji = freeSpots > 0 ? '✅' : '⏳';
      keyboard.push([{
        text: `${spotsEmoji} ${program.title.substring(0, 25)}...`,
        callback_data: `program_${program.id}`
      }]);
    });
  }

  if (byType.individual.length > 0) {
    keyboard.push([{ text: '👤 ИНДИВИДУАЛЬНЫЕ', callback_data: 'type_individual' }]);
    byType.individual.forEach(program => {
      keyboard.push([{
        text: `✅ ${program.title.substring(0, 25)}...`,
        callback_data: `program_${program.id}`
      }]);
    });
  }

  // Добавляем вспомогательные кнопки
  keyboard.push([
    { text: '💬 Спросить Аню', callback_data: 'ask_anna' },
    { text: '🏠 В начало', callback_data: 'nav_start' }
  ]);

  return keyboard;
}

export function generateAdminKeyboard() {
  return {
    inline_keyboard: [
      // Ряд 1: ОСНОВНЫЕ ОПЕРАЦИИ - то, что делает каждый день
      [
        { text: "📋 Заявки", callback_data: "admin_applications" },
        { text: "👥 Записи", callback_data: "admin_bookings" }
      ],

      // Ряд 2: ПЛАНИРОВАНИЕ - управление расписанием
      [
        { text: "💃 Активности", callback_data: "admin_activities" },
        { text: "📅 Расписание", callback_data: "admin_my_schedule" }
      ],

      // Ряд 3: АНАЛИТИКА И КОММУНИКАЦИИ
      [
        { text: "📊 Статистика", callback_data: "admin_stats" },
        { text: "📢 Рассылка", callback_data: "admin_broadcast" }
      ],

      // Ряд 4: ВСПОМОГАТЕЛЬНОЕ - настройки и контент
      [
        { text: "📚 Гайды", callback_data: "admin_guides" },
        { text: "🎉", callback_data: "admin_celebrate" } // Для быстрого доступа к похвале Ани
      ]
    ]
  };
}