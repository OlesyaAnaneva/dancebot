import TelegramBot from 'node-telegram-bot-api';
import { UserService } from '../database/services/UserService';
import { ProgramService } from '../database/services/ProgramService'; // ДОБАВИЛИ
import { config } from '../config';
import { escapeHtml, formatCurrency, formatDate } from '../utils/formatters';
import { Logger } from '../utils/logger';
import { generateMainKeyboard } from '../utils/keyboards';
import { GuideService } from '../database/services/GuideService';

export class StartHandler {

  constructor(
    private bot: TelegramBot,
    private userService: UserService,
    private programService: ProgramService,
    private guideService: GuideService,
  ) { }

  async handleStart(msg: TelegramBot.Message): Promise<void> {
    Logger.botEvent('COMMAND_START', msg.from?.id, {
      username: msg.from?.username,
      chatId: msg.chat.id
    });

    const chatId = msg.chat.id;
    const user = msg.from;

    if (!user) {
      Logger.error('Пользователь не найден в сообщении /start');
      return;
    }

    try {
      // Сохраняем/получаем пользователя
      const dbUser = await this.userService.getOrCreate(user);
      Logger.info(`Пользователь ${user.id} - ${dbUser ? 'найден в БД' : 'создан новый'}`);

      const userName = escapeHtml(user.first_name || 'танцор');
      const isNewUser = !dbUser?.phone;

      Logger.info(`Новый пользователь? ${isNewUser}`);

      // БОЛЬШЕ ИНФОРМАЦИИ ОБ АНЕ (добавим ключевые преимущества)
      const annaInfo = `👋 <b>Привет, ${userName}!</b> Я ${escapeHtml(config.anna.name)} 💃\n\n` +
        `<i>${escapeHtml(config.anna.description)}</i>\n\n` +
        `✨ <b>Этот бот поможет тебе быстро записаться на занятия и ничего не забыть.</b>\n` +
        `\n` +

        `Здесь ты можешь:\n` +
        `• записаться на тренировки\n` +
        `• посмотреть свои записи\n` +
        `• узнать адрес студии, цены и всю важную информацию\n` +
        ``;

      await this.bot.sendMessage(chatId, annaInfo, {
        parse_mode: 'HTML',
        reply_markup: generateMainKeyboard()
      });

      Logger.success(`Приветственное сообщение отправлено пользователю ${user.id}`);


    } catch (error) {
      Logger.error(`Ошибка в handleStart для пользователя ${user.id}:`, error);
      await this.bot.sendMessage(
        chatId,
        '❌ Произошла ошибка. Пожалуйста, попробуйте позже или напишите Ане напрямую: @anv_karelina'
      );
    }
  }

  // Метод для обработки навигационных команд
  async handleNavigation(chatId: number, page: string): Promise<void> {
    Logger.info(`Навигация: ${page} для чата ${chatId}`);

    try {
      switch (page) {
        case 'studio':
          await this.showStudioInfo(chatId);
          break;
        case 'contacts':
          await this.showContacts(chatId);
          break;
        case 'equipment':
          await this.showEquipmentInfo(chatId);
          break;
        case 'schedule':
          await this.showSchedule(chatId);
          break;
        // case 'prices':
        //   await this.showPrices(chatId);
        //   break;
        default:
          await this.bot.sendMessage(chatId, 'Выберите действие:');
      }
    } catch (error) {
      Logger.error(`Ошибка навигации ${page}:`, error);
    }
  }

  // ДОБАВЛЯЕМ НОВЫЙ МЕТОД ДЛЯ ПОКАЗА ГЛАВНОГО МЕНЮ
  async showMainMenu(chatId: number, messageId?: number): Promise<void> {
    Logger.botEvent('SHOW_MAIN_MENU', undefined, { chatId });

    try {
      // Получаем пользователя для персонализации
      const user = await this.userService.getByTelegramId(chatId);
      const userName = user?.first_name || 'танцор';

      const message = `🏠 <b>Главное меню</b>\n\n` +
        `Привет, ${userName}! Что вас интересует?`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '💃 Записаться', callback_data: 'nav_programs' }],
          [
            { text: '📅 Мои занятия', callback_data: 'nav_my_bookings' },
            { text: '🗓 Расписание студии', callback_data: 'nav_schedule' },
          ],
          [
            { text: '👗 Что взять', callback_data: 'nav_equipment' },
            { text: '📞 Контакты', callback_data: 'nav_contacts' },
            { text: '📍 Студия', callback_data: 'nav_studio' }
          ],
        ]
      };

      // Если есть messageId - редактируем существующее сообщение
      if (messageId) {
        try {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (editError) {
          // Если не удалось отредактировать, отправляем новое
          await this.bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        }
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }

      Logger.success(`Главное меню показано для чата ${chatId}`);
    } catch (error) {
      Logger.error(`Ошибка показа главного меню для чата ${chatId}:`, error);
      await this.bot.sendMessage(
        chatId,
        '❌ Произошла ошибка. Попробуйте команду /start'
      );
    }
  }

  private async showStudioInfo(chatId: number): Promise<void> {
    try {
      // Отправляем карту
      // await this.bot.sendVenue(
      //   chatId,
      //   config.studio.location.latitude,
      //   config.studio.location.longitude,
      //   escapeHtml(config.studio.name),
      //   `${escapeHtml(config.studio.address)}, ${escapeHtml(config.studio.floor)}`
      // );

      const studioMsg = `📍<b>Адрес студии:</b>\n\n` +
        `💃 <b>${escapeHtml(config.studio.name)}</b>\n\n` +
        ` <b>Адрес:</b> ${escapeHtml(config.studio.address)}\n` +
        ` (БЦ Галерея)\n` +
        ` <b>Этаж:</b> ${escapeHtml(config.studio.floor)}\n\n` +
        // ` <b>Сайт:</b> ${escapeHtml(config.studio.studioSite)}\n\n` +

        `🚗 <b>Как добраться:</b>\n` +
        `• Центральный вход с ул. Максима Горького\n` +
        `• Подъем на 2 этаж\n` +
        `• Справа — наша студия\n\n
        📍 <a href="https://yandex.ru/maps/-/CDaRMBcS">Открыть в Яндекс.Картах</a>`;


      await this.bot.sendMessage(chatId, studioMsg, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Что взять с собой',
                callback_data: 'nav_equipment'
              },
              { text: 'В начало', callback_data: 'nav_start' }
            ],
          ]
        }
      });
    } catch (error) {
      Logger.error('Ошибка показа информации о студии:', error);
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить информацию о студии');
    }
  }

  private async showContacts(chatId: number): Promise<void> {
    try {
      const contactsMsg = `📞 <b>Контакты</b>\n\n` +
        `• <b> Анна Карелина - преподаватель 💃</b>\n\n` +
        `• <b> Телефон:</b> ${escapeHtml(config.anna.phone)}\n` +
        `• <b> Телеграм:</b> ${escapeHtml(config.anna.telegram)}\n` +
        `• <b> Телеграм канал:</b> ${escapeHtml(config.anna.telegramGroup)}\n` +
        `• <b> Instagram:</b> ${escapeHtml(config.anna.instagram)}\n`;

      await this.bot.sendMessage(chatId, contactsMsg, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💬 Написать в Telegram',
                url: `https://t.me/${config.anna.telegram.replace('@', '')}`
              },
              {
                text: '📞 Позвонить',
                callback_data: 'show_phone_number'
              }
            ],
            [
              {
                text: '📸 Instagram',
                url: `https://instagram.com/${config.anna.instagram.replace('@', '')}`
              },
              {
                text: '👥 Группа',
                url: `https://t.me/${config.anna.telegramGroup.replace('@', '')}`
              }
            ],
            [{ text: '🔙 Назад', callback_data: 'nav_start' }]
          ]
        }
      });
    } catch (error) {
      Logger.error('Ошибка показа контактов:', error);
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить контакты');
    }
  }

  private async showEquipmentInfo(chatId: number): Promise<void> {
    const shoesGuide = await this.guideService.getShoesGuide();

    try {
      const gearMsg = `🎒 <b>Что взять с собой:</b>

1. 👗 Удобная одежда для танцев
   • Не стесняющая движения
   • Одежда, в которой ты себе нравишься

2. 👠 Туфли на каблуке
   • Чистая подошва
   • Танцевальные туфли на каблуке
   • Если нет - первые занятия можно в носках

3. 🦵 Наколенники 
   • Для защиты коленей на разминке

4. 💧 Бутылка воды
   • 0.5-1 литр
   
Важно: Заклейте подошву туфель тканевым пластырем или черным тейпом, чтобы не оставлять следы на полу.
Если следы остались — не беда! Влажными салфетками удаляем после занятия 😉

${shoesGuide ? '❓ <b>Нет туфель?</b> Смотри рекомендации ниже 👇' : ''}`;

      const keyboard = {
        inline_keyboard: [
          ...(shoesGuide ? [[{
            text: '👠 Как выбрать туфли',
            callback_data: `guide_${shoesGuide.id}`
          }]] : []),
          [{ text: '📋 Все программы', callback_data: 'nav_programs' }],
          [{ text: '🏠 В начало', callback_data: 'nav_start' }]
        ]
      };

      await this.bot.sendMessage(chatId, gearMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      Logger.error('Ошибка показа информации об экипировке:', error);
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить информацию');
    }
  }

  // private async showSchedule(chatId: number): Promise<void> {
  //   try {
  //     const programs = await this.programService.getAllActive();

  //     if (!programs.length) {
  //       await this.bot.sendMessage(chatId, "😢 Пока нет активных занятий, но скоро появятся!", {
  //         parse_mode: 'HTML',
  //         reply_markup: {
  //           inline_keyboard: [
  //             [{ text: '🏠 В начало', callback_data: 'nav_start' }]
  //           ]
  //         }
  //       });
  //       return;
  //     }

  //     let msg = `<b>📅 РАСПИСАНИЕ ЗАНЯТИЙ</b>\n\n`;
  //     msg += `\n──────────────\n\n`;

  //     for (const program of programs) {
  //       let duration = Number(program.duration_minutes) || 90;

  //       let durationText =
  //         duration === 60
  //           ? "1 час"
  //           : duration === 90
  //             ? "1,5 часа"
  //             : `${duration} мин`;


  //       msg += `💃 <b>${escapeHtml(program.title)}</b>\n`;
  //       msg += `🕘 Длительность: ${durationText}\n`;

  //       if (program.single_price && program.type === 'open_group') {
  //         msg += `💰 Разовое: ${program.single_price} ₽\n`;
  //         msg += `💳 Абонемент(4 занятия): ${program.price} ₽\n`;
  //       } else {
  //         msg += `💰 Цена: ${program.price} ₽\n`;
  //       }

  //       // ✅ подтягиваем ближайшие занятия
  //       const sessions = await this.programService.getUpcomingSessionsByProgram(program.id);

  //       if (!sessions.length) {
  //         msg += `\n📅 Расписание: ${escapeHtml(program.schedule || "уточняется")}\n`;
  //       } else {
  //         msg += `\n<b>Ближайшие занятия:</b>\n`;

  //         sessions.slice(0, 4).forEach((s: any) => {
  //           msg += `• ${formatDate(s.session_date)} — ${escapeHtml(s.session_time)}\n`;
  //         });
  //       }

  //       msg += `\n──────────────\n\n`;
  //     }

  //     msg += `📍 <i>${escapeHtml(config.studio.address)}</i>`;

  //     await this.bot.sendMessage(chatId, msg, {
  //       parse_mode: "HTML",
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: "💃 Записаться", callback_data: "nav_programs" }],
  //           [{ text: "🏠 В меню", callback_data: "nav_start" }]
  //         ]
  //       }
  //     });

  //   } catch (error) {
  //     console.error("showSchedule error:", error);
  //     await this.bot.sendMessage(chatId, "❌ Ошибка загрузки расписания");
  //   }
  // }


  private async showSchedule(chatId: number): Promise<void> {
    try {
      const programs = await this.programService.getAllActive();

      if (!programs.length) {
        await this.bot.sendMessage(chatId, "😢 Пока нет активных занятий, но скоро появятся!", {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 В начало', callback_data: 'nav_start' }]
            ]
          }
        });
        return;
      }

      // Группируем программы по типу
      const groupedPrograms: Record<string, any[]> = {
        group: [],
        intensive: [],
        open_group: [],
        individual: []
      };

      programs.forEach(program => {
        if (groupedPrograms[program.type]) {
          groupedPrograms[program.type].push(program);
        }
      });

      let msg = `<b>📅 РАСПИСАНИЕ ЗАНЯТИЙ</b>\n\n`;
      msg += `──────────────\n\n`;


      // 👥 ГРУППОВЫЕ ЗАНЯТИЯ
      if (groupedPrograms.group.length > 0) {
        msg += `👥 <b>ГРУППОВЫЕ ЗАНЯТИЯ</b>\n\n`;

        for (let i = 0; i < groupedPrograms.group.length; i++) {
          const program = groupedPrograms.group[i];
          let duration = Number(program.duration_minutes) || 90;
          let durationText = duration === 60 ? "1 час" : duration === 90 ? "1,5 часа" : `${duration} мин`;

          msg += `${i + 1}. 💃 <b>${escapeHtml(program.title)}</b>\n`;
          msg += `   🕘 Длительность: ${durationText}\n`;
          msg += `   💰 Цена: ${program.price} ₽\n`;

          // Получаем сессии отдельно
          const sessions = await this.programService.getUpcomingSessionsByProgram(program.id);

          if (sessions.length > 0) {
            msg += `   📅 <b>Ближайшие:</b>\n`;
            sessions.slice(0, 3).forEach((s: any) => {
              msg += `   • ${formatDate(s.session_date)} — ${escapeHtml(s.session_time)}\n`;
            });
          } else if (program.schedule) {
            msg += `   📅 Расписание: ${escapeHtml(program.schedule)}\n`;
          }
          msg += `\n`;
        }
        msg += `──────────────\n\n`;
      }

      // 🔥 ИНТЕНСИВЫ
      if (groupedPrograms.intensive.length > 0) {
        msg += `🔥 <b>ИНТЕНСИВЫ</b>\n\n`;

        for (let i = 0; i < groupedPrograms.intensive.length; i++) {
          const program = groupedPrograms.intensive[i];
          let duration = Number(program.duration_minutes) || 90;
          let durationText = duration === 60 ? "1 час" : duration === 90 ? "1,5 часа" : `${duration} мин`;

          msg += `${i + 1}. 🔥 <b>${escapeHtml(program.title)}</b>\n`;
          msg += `   📅 ${formatDate(new Date(program.start_date))}`;
          if (program.end_date) {
            msg += ` — ${formatDate(new Date(program.end_date))}`;
          }
          msg += `\n`;
          msg += `   🕘 Длительность: ${durationText}\n`;
          msg += `   💰 Цена: ${program.price} ₽\n`;

          if (program.schedule) {
            const scheduleLines = program.schedule.split('\n').filter((line: string) => line.includes('—'));
            if (scheduleLines.length > 0) {
              msg += `   📅 <b>Расписание:</b>\n`;
              scheduleLines.slice(0, 3).forEach((line: string) => {
                const cleanLine = line.replace(/<[^>]*>/g, '');
                msg += `   ${cleanLine}\n`;
              });
            }
          }
          msg += `\n`;
        }
        msg += `──────────────\n\n`;
      }

      // 🚪 ОТКРЫТЫЕ ГРУППЫ
      if (groupedPrograms.open_group.length > 0) {
        msg += `🚪 <b>ОТКРЫТЫЕ ГРУППЫ</b>\n\n`;

        for (let i = 0; i < groupedPrograms.open_group.length; i++) {
          const program = groupedPrograms.open_group[i];
          let duration = Number(program.duration_minutes) || 90;
          let durationText = duration === 60 ? "1 час" : duration === 90 ? "1,5 часа" : `${duration} мин`;

          msg += `${i + 1}. 🚪 <b>${escapeHtml(program.title)}</b>\n`;
          msg += `   🕘 Длительность: ${durationText}\n`;
          msg += `   💰 Разовое: ${program.single_price} ₽\n`;
          msg += `   💳 Абонемент (4 занятия): ${program.price} ₽\n`;

          const sessions = await this.programService.getUpcomingSessionsByProgram(program.id);
          if (sessions.length > 0) {
            msg += `   📅 <b>Ближайшие:</b>\n`;
            sessions.slice(0, 3).forEach((s: any) => {
              msg += `   • ${formatDate(s.session_date)} — ${escapeHtml(s.session_time)}\n`;
            });
          } else if (program.schedule) {
            msg += `   📅 Расписание: ${escapeHtml(program.schedule)}\n`;
          }
          msg += `\n`;
        }
        msg += `──────────────\n\n`;
      }

      // 👤 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ
      if (groupedPrograms.individual.length > 0) {
        msg += `👤 <b>ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ</b>\n\n`;

        for (let i = 0; i < groupedPrograms.individual.length; i++) {
          const program = groupedPrograms.individual[i];
          let duration = Number(program.duration_minutes) || 60;
          let durationText = duration === 60 ? "1 час" : duration === 90 ? "1,5 часа" : `${duration} мин`;

          msg += `${i + 1}. 👤 <b>${escapeHtml(program.title)}</b>\n`;
          msg += `   🕘 Длительность: ${durationText}\n`;
          msg += `   💰 Цена: ${program.price} ₽\n`;

          if (program.schedule) {
            msg += `   📅 Доступное время: ${escapeHtml(program.schedule)}\n`;
          }
          msg += `\n`;
        }
      }

      msg += `📍 <i>${escapeHtml(config.studio.address)}</i>`;

      await this.bot.sendMessage(chatId, msg, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💃 Записаться", callback_data: "nav_programs" }],
            [{ text: "🏠 В меню", callback_data: "nav_start" }]
          ]
        }
      });

    } catch (error) {
      console.error("showSchedule error:", error);
      await this.bot.sendMessage(chatId, "❌ Ошибка загрузки расписания");
    }
  }


  // Добавляем новый метод для показа гайда
  async showGuide(chatId: number, guideId: number): Promise<void> {
    try {
      const guide = await this.guideService.getById(guideId);
      if (!guide) {
        await this.bot.sendMessage(chatId, '❌ Гайд не найден');
        return;
      }

      let message = `📖 <b>${escapeHtml(guide.title)}</b>\n\n`;
      message += guide.content + '\n\n';
      message += `👆 Сохрани себе, чтобы не потерять!`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "💃 Записаться", callback_data: "nav_programs" }],
          [{ text: '🏠 В начало', callback_data: 'nav_start' }]
        ]
      };

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: keyboard
      });

    } catch (error) {
      Logger.error('Error showing guide:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки гайда');
    }
  }

  // Можно добавить раздел "Гайды" в информацию
  private async showInfoBlocks(chatId: number): Promise<void> {
    try {
      const guides = await this.guideService.getAll();

      const infoMessage = `ℹ️ <b>Полезная информация</b>\n\n`;

      const keyboard: any = {
        inline_keyboard: [
          [{ text: '📍 Студия', callback_data: 'nav_studio' }],
          [{ text: '📞 Контакты', callback_data: 'nav_contacts' }],
          [{ text: '👗 Что взять', callback_data: 'nav_equipment' }],
        ]
      };

      // Добавляем гайды в меню
      if (guides.length > 0) {
        guides.forEach(guide => {
          keyboard.inline_keyboard.push([{
            text: `📖 ${guide.title}`,
            callback_data: `guide_${guide.id}`
          }]);
        });
      }

      keyboard.inline_keyboard.push([{ text: '🏠 В начало', callback_data: 'nav_start' }]);

      await this.bot.sendMessage(chatId, infoMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      Logger.success(`Информационные блоки показаны для чата ${chatId}`);
    } catch (error) {
      Logger.error('Ошибка показа информационных блоков:', error);
    }
  }

  async showGuidesList(chatId: number): Promise<void> {
    try {
      const guides = await this.guideService.getAll();

      if (guides.length === 0) {
        await this.bot.sendMessage(chatId, '📭 Пока нет созданных гайдов', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'nav_info' }]
            ]
          }
        });
        return;
      }

      let message = '📚 <b>Гайды и полезная информация</b>\n\n';
      message += 'Выберите интересующую тему:';

      const keyboard = {
        inline_keyboard: guides.map(g => ([
          { text: `📖 ${g.title}`, callback_data: `guide_${g.id}` }
        ]))
      };

      // Добавляем кнопку назад
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'nav_info' }]);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

    } catch (error) {
      Logger.error('Error showing guides list:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки списка гайдов');
    }
  }
}

