import { supabase } from '../supabase';
import { User } from '../models/User';

export class UserService {
  private tableName = 'users'; // Убедитесь, что это public.users

  async getOrCreate(telegramUser: any): Promise<User | null> {
    console.log(`👤 Поиск/создание пользователя: ${telegramUser.id} (@${telegramUser.username})`);

    try {
      // 1. Ищем по telegram_id
      const { data: existingUser, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('telegram_id', telegramUser.id)
        .maybeSingle();

      if (existingUser) {
        console.log(`✅ Пользователь найден:`, existingUser);
        return existingUser;
      }

      // 2. Если не нашли, создаём нового (НЕ указываем id!)
      console.log(`➕ Создание нового пользователя: ${telegramUser.id}`);
      const { data: newUser, error: createError } = await supabase
        .from(this.tableName)
        .insert({
          telegram_id: telegramUser.id,
          username: telegramUser.username,
          first_name: telegramUser.first_name || '',
          last_name: telegramUser.last_name || '',
          phone: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
          // id не указываем — пусть база сама назначает
        })
        .select()
        .single();

      if (createError) {
        // Если ошибка дубликата — пробуем найти ещё раз (гонка)
        if (createError.code === '23505') {
          console.log('⚠️ Конфликт при создании, пробуем найти...');
          const { data: retryUser } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('telegram_id', telegramUser.id)
            .maybeSingle();

          if (retryUser) return retryUser;
        }

        console.error(`❌ Ошибка создания:`, createError);
        return null;
      }

      console.log(`✅ Новый пользователь создан с id=${newUser.id}`);
      return newUser;
    } catch (error) {
      console.error(`💥 Критическая ошибка:`, error);
      return null;
    }
  }

  async updatePhone(telegramId: number, phone: string): Promise<boolean> {
    try {
      console.log(`📞 Обновление телефона для ${telegramId}: ${phone}`);

      // Нормализуем номер телефона
      let normalizedPhone = phone.replace(/\s+/g, '');

      if (normalizedPhone.startsWith('8') && normalizedPhone.length === 11) {
        normalizedPhone = '+7' + normalizedPhone.substring(1);
      } else if (normalizedPhone.startsWith('7') && normalizedPhone.length === 11) {
        normalizedPhone = '+' + normalizedPhone;
      } else if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+' + normalizedPhone;
      }

      console.log(`📞 Нормализованный телефон: ${normalizedPhone}`);

      const { error } = await supabase
        .from(this.tableName)
        .update({
          phone: normalizedPhone,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId);

      if (error) {
        console.error(`❌ Ошибка обновления телефона для ${telegramId}:`, error);
        return false;
      }

      console.log(`✅ Телефон обновлен для пользователя ${telegramId}`);
      return true;
    } catch (error) {
      console.error(`💥 Критическая ошибка обновления телефона для ${telegramId}:`, error);
      return false;
    }
  }

  async getByTelegramId(telegramId: number): Promise<User | null> {
    try {
      console.log(`🔍 Поиск пользователя по telegram_id в ${this.tableName}: ${telegramId}`);

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`⚠️ Пользователь ${telegramId} не найден в ${this.tableName}`);
        } else {
          console.error(`❌ Ошибка поиска пользователя ${telegramId}:`, error);
        }
        return null;
      }

      console.log(`✅ Пользователь найден в ${this.tableName}:`, {
        id: data.id,
        telegram_id: data.telegram_id,
        phone: data.phone,
        first_name: data.first_name
      });

      return data as User;
    } catch (error) {
      console.error(`💥 Критическая ошибка поиска пользователя ${telegramId}:`, error);
      return null;
    }
  }

}