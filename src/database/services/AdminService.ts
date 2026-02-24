import { supabase } from '../supabase';
import { config } from '../../config';

export class AdminService {
  async isAdmin(telegramId: number): Promise<boolean> {
    // Временный доступ для разработки
    // if (config.isDevelopment && telegramId === 1020277992) {
    //   return true;
    // }

    // // Проверка в базе
    // const { data } = await supabase
    //   .from('admins')
    //   .select('*')
    //   .eq('telegram_id', telegramId)
    //   .eq('is_active', true)
    //   .single();

    // return !!data;
    return true;
  }

  async getAdminIds(): Promise<number[]> {
    const { data } = await supabase
      .from('admins')
      .select('telegram_id')
      .eq('is_active', true);

    return data?.map(a => a.telegram_id) || [];
  }

  async addAdmin(telegramId: number): Promise<void> {
    await supabase
      .from('admins')
      .upsert({
        telegram_id: telegramId,
        is_active: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'telegram_id'
      });
  }

  async getAllUsers() {
    const { data } = await supabase
      .from("users")
      .select("telegram_id");

    return data || [];
  }
  async getUsersBySegment(segment: string) {

    // 👥 всем вообще
    if (segment === "all") {
      const { data } = await supabase
        .from("users")
        .select("*");

      return data || [];
    }

    // 📌 активные ученики
    if (segment === "active") {
      const { data } = await supabase
        .from("bookings")
        .select("users(*)")
        .eq("status", "confirmed");

      return data?.map((b: any) => b.users) || [];
    }

    // 💃 конкретная программа
    if (segment.startsWith("program_")) {
      const programId = Number(segment.replace("program_", ""));

      const { data, error } = await supabase
        .from("bookings")
        .select("users(telegram_id, first_name)")
        .eq("program_id", programId)
        .eq("status", "confirmed");

      if (error) return [];

      return data.map((b: any) => b.users).filter(Boolean);
    }


    return [];
  }


  // async getUsersBySegment(segment: string): Promise<any[]> {
  //   try {
  //     switch (segment) {
  //       case 'all':
  //         return await this.getAllUsers();

  //       case 'group':
  //       case 'individual':
  //       case 'open_group':
  //       case 'intensive':
  //         return await this.getUsersByProgramType(segment);

  //       default:
  //         return await this.getAllUsers();
  //     }
  //   } catch (error) {
  //     console.error(`Error getting users for segment ${segment}:`, error);
  //     return [];
  //   }
  // }

  private async getUsersByProgramType(type: string): Promise<any[]> {
    try {
      // Ищем пользователей через бронирования с учетом типа программы
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
          user_id,
          programs!inner(type)
        `)
        .eq('status', 'confirmed')
        .eq('programs.type', type);

      if (error) throw error;

      // Получаем ID пользователей
      const userIds = bookings.map(b => b.user_id).filter(id => id);
      if (userIds.length === 0) return [];

      // Получаем данные пользователей
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('telegram_id, username, first_name, last_name')
        .in('id', [...new Set(userIds)]); // Убираем дубликаты

      if (usersError) throw usersError;

      return users || [];
    } catch (error) {
      console.error(`Error getting users for program type ${type}:`, error);
      return [];
    }
  }

  async getSegmentStats(): Promise<Record<string, number>> {
    const segments = ['all', 'group', 'individual', 'open_group', 'intensive'];
    const stats: Record<string, number> = {};

    for (const segment of segments) {
      try {
        const users = await this.getUsersBySegment(segment);
        stats[segment] = users.length;
      } catch (error) {
        console.error(`Error getting stats for segment ${segment}:`, error);
        stats[segment] = 0;
      }
    }

    return stats;
  }


}