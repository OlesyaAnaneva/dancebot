import TelegramBot from 'node-telegram-bot-api';
import { GuideService } from '../database/services/GuideService';
import { AdminService } from '../database/services/AdminService';
import { escapeHtml } from '../utils/formatters';

export class AdminGuideHandler {
  private addingGuideMode = false;
  private editingGuideId: number | null = null;
  private addingLinksMode = false;
  private guideData: Partial<any> = {};
  
    isAddingLinksMode(chatId?: number): boolean {
      return this.addingLinksMode;
    }
  constructor(
    private bot: TelegramBot,
    private guideService: GuideService,
    private adminService: AdminService
  ) { }

  private async checkAccess(chatId: number, userId?: number): Promise<boolean> {
    if (!userId) {
      await this.bot.sendMessage(chatId, '❌ Пользователь не найден');
      return false;
    }

    const isAdmin = await this.adminService.isAdmin(userId);
    if (!isAdmin) {
      await this.bot.sendMessage(chatId, '⛔ Нет доступа');
      return false;
    }

    return true;
  }

  async showGuidesMenu(chatId: number, userId?: number): Promise<void> {
    console.log(`📚 Showing guides menu for chat ${chatId}, user ${userId}`);

    if (!await this.checkAccess(chatId, userId)) return;

    const guides = await this.guideService.getAll();
    console.log(`Found ${guides.length} guides`);

    let message = '📚 <b>Управление гайдами</b>\n\n';

    if (guides.length === 0) {
      message += 'Пока нет созданных гайдов';
    } else {
      message += 'Существующие гайды:\n';
      guides.forEach((g, i) => {
        message += `${i + 1}. ${escapeHtml(g.title)} [${g.category}]\n`;
      });
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ Создать новый гайд', callback_data: 'admin_guide_create' }],
        ...guides.map(g => ([
          { text: `✏️ ${g.title}`, callback_data: `admin_guide_edit_${g.id}` },
          { text: '🗑', callback_data: `admin_guide_delete_${g.id}` }
        ])),
        [{ text: '🔙 Назад в админку', callback_data: 'admin_panel' }]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  async startCreateGuide(chatId: number): Promise<void> {
    this.addingGuideMode = true;
    this.guideData = {};

    const keyboard = {
      inline_keyboard: [
        [{ text: '❌ Отмена', callback_data: 'admin_guide_cancel' }]
      ]
    };

    await this.bot.sendMessage(
      chatId,
      '📝 <b>Создание нового гайда</b>\n\n' +
      'Шаг 1: Введи название гайда\n' +
      'Например: "Как выбрать танцевальные туфли"',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  }

  async handleGuideInput(chatId: number, text: string): Promise<boolean> {
    console.log(`📝 handleGuideInput START:`, {
      addingGuideMode: this.addingGuideMode,
      hasTitle: !!this.guideData.title,
      hasCategory: !!this.guideData.category,
      hasContent: !!this.guideData.content,
      text: text
    });

    if (!this.addingGuideMode) {
      console.log('📝 Not in guide mode');
      return false;
    }

    // Шаг 1: ввод названия
    if (!this.guideData.title) {
      console.log('📝 STEP 1: Setting title');
      this.guideData.title = text;

      await this.bot.sendMessage(
        chatId,
        'Шаг 2: Выбери категорию:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👠 Обувь', callback_data: 'guide_category_shoes' }],
              [{ text: '👗 Одежда', callback_data: 'guide_category_equipment' }],
              [{ text: '📋 Общее', callback_data: 'guide_category_general' }]
            ]
          }
        }
      );
      return true;
    }

    // Шаг 3: ввод содержания (после выбора категории)
    if (!this.guideData.content) {
      console.log('📝 STEP 3: Setting content');
      this.guideData.content = text;

      // Сразу создаём гайд
      await this.finishGuideCreation(chatId);
      return true;
    }

    console.log('📝 Already have title, category and content, ignoring:', text);
    return false;
  }

  async finishGuideCreation(chatId: number): Promise<void> {
    try {
      console.log('📝 Finishing guide creation with data:', this.guideData);

      await this.guideService.create({
        title: this.guideData.title!,
        content: this.guideData.content || '',
        links: [], // больше не используем отдельные ссылки, всё в content
        category: this.guideData.category || 'general',
        is_published: true,
        sort_order: 0
      });

      await this.bot.sendMessage(
        chatId,
        '✅ Гайд успешно создан!',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📚 Управление гайдами', callback_data: 'admin_guides' }]
            ]
          }
        }
      );

      this.addingGuideMode = false;
      this.guideData = {};
    } catch (error) {
      console.error('Error creating guide:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при создании гайда');
    }
  }

  async deleteGuide(chatId: number, guideId: number, userId?: number): Promise<void> {
    if (!await this.checkAccess(chatId, userId)) return;

    try {
      await this.guideService.delete(guideId);
      await this.bot.sendMessage(chatId, '✅ Гайд удален');
      await this.showGuidesMenu(chatId, userId);
    } catch (error) {
      console.error('Error deleting guide:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при удалении гайда');
    }
  }

    async handleGuideLinks(chatId: number, text: string): Promise<void> {
      if (!this.addingLinksMode) {
        console.log('📝 Not in links mode');
        return;
      }

      if (text.toLowerCase() === 'готово') {
        await this.finishGuideCreation(chatId);
        return;
      }

      if (!this.guideData.links) {
        this.guideData.links = [];
      }

      const parts = text.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        const link = {
          title: parts[0],
          url: parts[1],
          price: parts[2] || null
        };

        this.guideData.links.push(link);

        await this.bot.sendMessage(
          chatId,
          `✅ Добавлено: ${link.title}\n\nМожешь добавить еще или нажми "Готово"`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Готово', callback_data: 'guide_links_done' }]
              ]
            }
          }
        );
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Неправильный формат. Используй: Название | URL | Цена (опционально)\n\n' +
          'Пример: Туфли Capezio | https://www.wildberries.ru/catalog/... | 6000₽'
        );
      }
    }

  async handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const data = query.data!;
    const chatId = query.message!.chat.id;
    const userId = query.from.id;

    console.log(`📚 AdminGuideHandler handling callback: ${data}`);

    try {
      if (data === 'admin_guides') {
        console.log('📚 Showing guides menu');
        await this.showGuidesMenu(chatId, userId);
        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      if (data === 'admin_guide_create') {
        console.log('📚 Creating new guide');
        this.addingGuideMode = true;
        this.guideData = {};
        await this.startCreateGuide(chatId);
        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      if (data.startsWith('guide_category_')) {
        const category = data.replace('guide_category_', '');
        console.log(`📝 STEP 2: Category selected: ${category}`);

        this.guideData.category = category;

        await this.bot.answerCallbackQuery(query.id);

        await this.bot.sendMessage(
          chatId,
          '📝 <b>Шаг 3: Напиши содержание гайда</b>\n\n' +
          'Ты можешь использовать любой текст, вставлять ссылки, описания цен и т.д.\n\n' +
          'Например:\n' +
          '🎯 Туфли для начинающих:\n' +
          'https://www.wildberries.ru/catalog/...\n' +
          'Цена: около 5000₽\n\n' +
          '💃 Туфли для профи:\n' +
          'https://www.wildberries.ru/catalog/...\n' +
          'Цена: около 10000₽\n\n' +
          '👇 Введи текст сейчас:',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Отмена', callback_data: 'admin_guide_cancel' }]
              ]
            }
          }
        );
        return;
      }

      if (data === 'admin_guide_cancel') {
        console.log('📝 Cancelling guide creation');
        this.addingGuideMode = false;
        this.guideData = {};
        await this.bot.sendMessage(chatId, '❌ Создание гайда отменено');
        await this.showGuidesMenu(chatId, userId);
        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      if (data.startsWith('admin_guide_edit_')) {
        const guideId = parseInt(data.replace('admin_guide_edit_', ''));
        console.log(`📝 Editing guide ${guideId}`);
        await this.bot.answerCallbackQuery(query.id, { text: 'Редактирование пока не реализовано' });
        return;
      }

      if (data.startsWith('admin_guide_delete_')) {
        const guideId = parseInt(data.replace('admin_guide_delete_', ''));
        console.log(`📝 Deleting guide ${guideId}`);
        await this.deleteGuide(chatId, guideId, userId);
        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      console.log(`📝 Unknown callback: ${data}`);
      await this.bot.answerCallbackQuery(query.id, { text: '⚠️ Неизвестная команда' });

    } catch (error) {
      console.error('Error in AdminGuideHandler callback:', error);
      await this.bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
    }
  }
}