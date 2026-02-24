import TelegramBot from 'node-telegram-bot-api';
import { ProgramService } from '../database/services/ProgramService';
import { formatProgram } from '../utils/formatters';
import { generateProgramsKeyboard } from '../utils/keyboards';
import { UserService } from '../database/services';

export class ProgramsHandler {
  constructor(
    private bot: TelegramBot,
    private programService: ProgramService,
    private userService?: UserService // Добавим опционально
  ) { }

  async showPrograms(chatId: number): Promise<void> {
    try {
      const programs = await this.programService.getAllActive();

      if (programs.length === 0) {
        await this.bot.sendMessage(chatId,
          `📭 Сейчас нет активных занятий.\n\nСледи за обновлениями 💛`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "💬 Написать Ане", url: "https://t.me/anv_karelina" }],
                [{ text: "🏠 В меню", callback_data: "nav_start" }]
              ]
            }
          }
        );
        return;
      }

      // Группируем программы по типу
      const groupedPrograms: { [key: string]: any[] } = {
        group: [],
        intensive: [],
        open_group: [],
        individual: []
      };

      programs.forEach(program => {
        if (groupedPrograms[program.type]) {
          groupedPrograms[program.type].push(program);
        } else {
          groupedPrograms[program.type] = [program];
        }
      });

      // Тексты для типов программ
      const typeTitles: { [key: string]: string } = {
        group: '👥 ГРУППОВЫЕ ЗАНЯТИЯ',
        intensive: '🔥 ИНТЕНСИВЫ',
        open_group: '🚪 ОТКРЫТЫЕ ГРУППЫ',
        individual: '👤 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ'
      };

      // Порядок вывода типов
      const typeOrder = ['group', 'intensive', 'open_group', 'individual'];

      // 🔥 Красивый список с группировкой
      let text = `💃 <b>Запись открыта!</b>\n\n`;

      // Собираем кнопки для каждого типа
      const keyboard: any[] = [];

      for (const type of typeOrder) {
        const programsOfType = groupedPrograms[type];

        if (programsOfType && programsOfType.length > 0) {
          // Добавляем заголовок категории
          text += `<b>${typeTitles[type]}</b>\n\n`;

          // Добавляем программы этой категории
          programsOfType.forEach((p, index) => {
            const free = p.max_participants - p.current_participants;
            // const spotsEmoji = free > 0 ? '✅' : '⏳';

            // text +=
            //   `${index + 1}. <b>${p.title}</b>\n` +
            //   (p.start_date ? `   📅 ${p.start_date}\n` : '') +
            //   `   👥 ${spotsEmoji} ${free} мест\n` +
            //   `   💰 ${p.price} ₽\n\n`;
            // 💰 Красивое отображение цены
            let priceText = '';

            if (p.type === 'open_group') {
              priceText =
                `   💰 <b>4 занятия:</b> ${p.price} ₽\n`;

              if (p.single_price != null) {
                priceText += `   💳 <b>Разовое:</b> ${p.single_price} ₽\n`;
              }
            } else {
              priceText = `   💰 ${p.price} ₽\n`;
            }


            text +=
              `${index + 1}. <b>${p.title}</b>\n` +
              (p.start_date ? `   📅 ${p.start_date}\n` : '') +
              `   👥 ${free} мест\n` +
              priceText +
              `\n`;

            // Кнопка для программы
            keyboard.push([
              {
                text: `${type === 'group' ? '👥' : type === 'intensive' ? '🔥' : type === 'open_group' ? '🚪' : '👤'} ${p.title.substring(0, 25)}`,
                callback_data: `program_${p.id}`
              }
            ]);
          });

          // Добавляем разделитель между группами (кроме последней)
          if (type !== typeOrder[typeOrder.length - 1]) {
            // Можно добавить пустую строку или разделитель
            text += '──────────────\n\n';

            // Или пустую кнопку-разделитель (необязательно)
            // keyboard.push([{ text: '──────────────', callback_data: 'divider' }]);
          }
        }
      }

      // Добавляем навигационные кнопки внизу
      keyboard.push([
        { text: "💬 Спросить Аню", url: "https://t.me/anv_karelina" },
        { text: "🏠 В меню", callback_data: "nav_start" }
      ]);

      // Добавляем кнопки для быстрого перехода по типам (опционально)
      // const quickTypeButtons = [];
      for (const type of typeOrder) {
        if (groupedPrograms[type] && groupedPrograms[type].length > 0) {
          // const emoji = type === 'group' ? '👥 ГРУППОВЫЕ ЗАНЯТИЯ' :
          //   type === 'intensive' ? '🔥 ИНТЕНСИВЫ' :
          //     type === 'open_group' ? '🚪 ОТКРЫТЫЕ ГРУППЫ' : '👤 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ';
          // quickTypeButtons.push({
          //   text: `${emoji}`,
          //   callback_data: `program_${type}` // или nav_${type}_programs
          // });
        }
      }

      // if (quickTypeButtons.length > 0) {
      //   keyboard.unshift(quickTypeButtons); // Добавляем в начало
      // }

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      console.error("Error showing programs:", error);
      await this.bot.sendMessage(chatId, "❌ Не удалось загрузить занятия");
    }
  }

  async showProgramDetails(chatId: number, programId: number): Promise<void> {
    try {
      const program = await this.programService.getById(programId);

      if (!program) {
        await this.bot.sendMessage(chatId, '❌ Программа не найдена');
        return;
      }


      await this.bot.sendMessage(chatId, formatProgram(program), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Записаться', callback_data: `book_${programId}` }],
            [
              { text: '📍 Адрес студии', callback_data: 'nav_studio' },
              { text: '👗 Что взять', callback_data: 'nav_equipment' }
            ],
            [
              { text: '📋 Все программы', callback_data: 'nav_programs' },
              { text: '🏠 В начало', callback_data: 'nav_start' }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Error showing program details:', error);
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить информацию');
    }
  }

  async showProgramsByType(chatId: number, type: string): Promise<void> {
    try {
      let programs: any[] = [];
      let title = '';

      // Получаем программы по типу
      switch (type) {
        case 'group':
          programs = await this.programService.getByType('group');
          title = '👥 ГРУППОВЫЕ ЗАНЯТИЯ';
          break;
        case 'intensive':
          programs = await this.programService.getByType('intensive');
          title = '🔥 ИНТЕНСИВЫ';
          break;
        case 'open_group':
          programs = await this.programService.getByType('open_group');
          title = '🎪 ОТКРЫТЫЕ ГРУППЫ';
          break;
        case 'individual':
          programs = await this.programService.getByType('individual');
          title = '👤 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ';
          break;
        default:
          await this.showPrograms(chatId);
          return;
      }

      if (programs.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `😔 Сейчас нет доступных программ в категории "${title}".\n\n` +
          `Попробуйте другие категории или свяжитесь с Аней для уточнения.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💬 Спросить у Ани', callback_data: 'ask_anna' }],
                [{ text: '💃 Все программы', callback_data: 'nav_programs' }]
              ]
            }
          }
        );
        return;
      }

      // Формируем клавиатуру с программами
      const keyboard = [];

      // Заголовок категории
      keyboard.push([{ text: title, callback_data: `type_${type}_header` }]);

      // Программы этой категории
      programs.forEach(program => {
        const freeSpots = program.max_participants - program.current_participants;
        const spotsEmoji = freeSpots > 0 ? '✅' : '⏳';
        const buttonText = `${spotsEmoji} ${program.title.substring(0, 25)}`;

        keyboard.push([{
          text: buttonText,
          callback_data: `program_${program.id}`
        }]);
      });

      // Навигация
      keyboard.push([
        { text: '💬 Спросить у Ани', callback_data: 'ask_anna' },
        { text: '💃 Все программы', callback_data: 'nav_programs' }
      ]);

      keyboard.push([
        { text: '🏠 В начало', callback_data: 'nav_start' }
      ]);

      await this.bot.sendMessage(
        chatId,
        `${title}\n\n<i>Выберите программу для просмотра подробностей:</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );

    } catch (error) {
      console.error(`Error showing programs by type ${type}:`, error);
      await this.bot.sendMessage(chatId, '❌ Не удалось загрузить программы');
    }
  }
}


