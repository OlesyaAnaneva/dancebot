import { supabase } from '../supabase';
import { Booking, BookingWithRelations } from '../models/Booking';
import { Application } from '../models/Application';

export class BookingService {
  async createFromApplication(application: Application): Promise<Booking | null> {
    // Build initial payload
    const payload: Record<string, any> = {
      application_id: application.id,
      program_id: application.program_id,
      user_id: application.user_id || 0,
      user_name: application.user_name,
      user_phone: application.user_phone,
      amount: application.amount,
      session_id: application.session_id || null,

      status: "confirmed",        // ✅
      payment_status: "paid",     // ✅

      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };


    // Try to fetch actual column names for the bookings table and filter payload
    try {
      const { data: cols, error: colsErr } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'bookings');

      if (!colsErr && Array.isArray(cols) && cols.length > 0) {
        const allowed = new Set((cols as any[]).map(c => c.column_name));
        for (const key of Object.keys({ ...payload })) {
          if (!allowed.has(key)) {
            console.warn(`BookingService.createFromApplication: removing unsupported column from payload: ${key}`);
            delete payload[key];
          }
        }
      } else if (colsErr) {
        console.warn('BookingService.createFromApplication: could not fetch table columns, will fallback to robust retry', colsErr);
      }
    } catch (e) {
      console.warn('BookingService.createFromApplication: error fetching table columns, will fallback to robust retry', e);
    }

    // Now attempt insert; if it still fails due to a missing-column PGRST204, fall back
    // to removing the offending key and retrying a few times.
    let attempts = 0;
    const maxAttempts = Object.keys(payload).length + 3;

    while (attempts < maxAttempts) {
      attempts += 1;
      const { data: booking, error } = await supabase
        .from('bookings')
        .insert(payload)
        .select()
        .single();

      if (!error && booking) {

        // ✅ если это абонемент → прикрепляем занятия
        const sessionIds = (application as any).session_ids;

        if (sessionIds && Array.isArray(sessionIds) && sessionIds.length > 0) {

          console.log("📌 attachSelectedSessions:", sessionIds);

          await this.attachSelectedSessions(
            booking.id,
            sessionIds.map((id) => Number(id))
          );

          console.log("✅ booking_sessions заполнены");
        }

        return booking;
      }





      if (error) {
        console.error('BookingService.createFromApplication: insert error', error);

        const msg: string = (error.message || '').toString();

        // Detect unique constraint / duplicate booking (Postgres 23505 or textual hints)
        if (error.code === '23505' || /duplicate key|unique constraint|uniq_user_program_paid_booking|already exists/i.test(msg)) {
          console.warn('BookingService.createFromApplication: detected duplicate booking error');
          throw new Error('duplicate_booking');
        }

        const m = msg.match(/Could not find the '([^']+)' column/);
        if (m && m[1] && payload.hasOwnProperty(m[1])) {
          const col = m[1];
          console.warn(`BookingService.createFromApplication: ${col} column missing, retrying without it`);
          delete payload[col];
          continue;
        }

        return null;
      }

      // ✅ если это абонемент → прикрепляем занятия
      // const { data: sessions } = await supabase
      //   .from("application_sessions")
      //   .select("session_id")
      //   .eq("application_id", application.id);

      // if (sessions?.length) {
      //   await this.attachSelectedSessions(
      //     booking.id,
      //     sessions.map(s => s.session_id)
      //   );
      // }

    }

    console.error('BookingService.createFromApplication: failed to insert booking after retries');
    return null;
  }

  async getAll(): Promise<BookingWithRelations[]> {
    // Try relation select first
    let result = await supabase
      .from('bookings')
      .select(`
    *,
    programs:programs (
      id,
      title,
      type,
      schedule,
        single_price,
      duration_minutes,
      max_participants,
      current_participants,
      group_link,
      status
    ),
      users:users (
        telegram_id,
        first_name,
        last_name,
        username
      )
  `)
      .eq('programs.status', 'active')
      .order('created_at', { ascending: false });


    // If PostgREST complains about missing user columns, retry without last_name
    if (result.error && result.error.code === '42703' && result.error.message && result.error.message.includes('users_1.last_name')) {
      console.warn('BookingService.getAll: users.last_name not found, retrying without last_name');
      result = await supabase
        .from('bookings')
        .select(`
          *,
          programs:programs(title, type),
          users:users(telegram_id, first_name)
        `)
        .order('created_at', { ascending: false });
    }

    const { data, error } = result as any;

    if (error || !data) {
      if (error) console.warn('BookingService.getAll: relation select error', error);
      // Fallback to plain select
      const { data: plain } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });

      const bookingsPlain = (plain as BookingWithRelations[]) || [];

      // Batch-fetch related programs and users to attach relations for formatting
      try {
        const programIds = Array.from(new Set(bookingsPlain.map(b => b.program_id).filter(Boolean)));
        if (programIds.length > 0) {
          const { data: progs } = await supabase
            .from('programs')
            .select('id, title, type, status')
            .in('id', programIds as any[]);

          const progMap: Record<number, any> = {};
          (progs || []).forEach((p: any) => { progMap[p.id] = p; });
          bookingsPlain.forEach(b => { if (progMap[b.program_id]) b.programs = progMap[b.program_id]; });
        }

        const userIds = Array.from(new Set(bookingsPlain.map(b => b.user_id).filter(Boolean)));
        if (userIds.length > 0) {
          // Try to fetch common user columns (including username) and attach
          const { data: users } = await supabase
            .from('users')
            .select('id, telegram_id, username, first_name')
            .in('id', userIds as any[]);

          const userMap: Record<number, any> = {};
          (users || []).forEach((u: any) => { userMap[u.id] = u; });
          bookingsPlain.forEach(b => { if (userMap[b.user_id]) b.users = userMap[b.user_id]; });
        }
      } catch (e) {
        console.warn('BookingService.getAll: failed to attach relations on fallback', e);
      }

      return bookingsPlain;
    }

    return data as BookingWithRelations[] || [];
  }

  async getStats(): Promise<{
    total: number;
    totalAmount: number;
    byType: {
      group: number;
      individual: number;
      open_single: number;
      open_full: number;
      intensive: number;
    };
  }> {
    // Fetch bookings with program info to compute breakdowns
    const { data } = await supabase
      .from('bookings')
      .select('*, programs:programs(id, type, price, single_price)');

    if (!data) {
      return {
        total: 0,
        totalAmount: 0,
        byType: { group: 0, individual: 0, open_single: 0, open_full: 0, intensive: 0 }
      };
    }

    const total = data.length;
    const totalAmount = data.reduce((sum: number, booking: any) => sum + (booking.amount || 0), 0);

    const byType = {
      group: 0,
      individual: 0,
      open_single: 0,
      open_full: 0,
      intensive: 0
    };

    data.forEach((b: any) => {
      const prog = b.programs;
      const amount = Number(b.amount || 0);
      if (!prog || !prog.type) return;

      switch (prog.type) {
        case 'group':
          byType.group += amount;
          break;
        case 'individual':
          byType.individual += amount;
          break;
        case 'intensive':
          byType.intensive += amount;
          break;
        case 'open_group':
          // Distinguish single vs full by comparing amount to program.single_price (if available)
          if (prog.single_price && amount === Number(prog.single_price)) {
            byType.open_single += amount;
          } else {
            byType.open_full += amount;
          }
          break;
        default:
          break;
      }
    });

    return { total, totalAmount, byType };
  }

  async markAsAttended(bookingId: number): Promise<void> {
    await supabase
      .from('bookings')
      .update({
        attended: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);
  }

//   async getByUserId(userId: number) {
//     const { data } = await supabase
//       .from("bookings")
//       .select(`
//   *,
//   programs:programs!inner(id,title,type,schedule),
//   users:users(id,telegram_id,first_name,last_name)
// `)
//       .eq("user_id", userId)
//       .eq("status", "confirmed");

//     return data || [];
//   }

  async getByUserId(userId: number) {
    const { data, error } = await supabase
      .from("bookings")
      .select(`
      *,
      programs:programs!inner(*),
      users:users(*)
    `)
      .eq("user_id", userId)
      .eq("status", "confirmed");

    if (error) {
      console.error("BookingService.getByUserId error:", error);
      return [];
    }

    // Оставляем только те бронирования, у которых программа активна
    const activeBookings = (data || []).filter(b => b.programs?.status === 'active');
    return activeBookings;
  }


  async getConfirmedByUser(userId: number) {
    const { data } = await supabase
      .from("bookings")
      .select(`
      *,
      programs:programs(title),
      next_session:program_sessions(session_date, session_time)
    `)
      .eq("user_id", userId)
      .eq("status", "confirmed");

    return data || [];
  }

  async attachSelectedSessions(bookingId: number, sessionIds: number[]) {
    const inserts = sessionIds.map(id => ({
      booking_id: bookingId,
      session_id: id
    }));

    const { error } = await supabase
      .from("booking_sessions")
      .insert(inserts);

    if (error) {
      console.error("❌ attachSelectedSessions error:", error);
      throw error;
    }
  }


  async getBookingSessions(bookingId: number) {
    const { data, error } = await supabase
      .from("booking_sessions")
      .select("session_id, program_sessions(session_date, session_time)")
      .eq("booking_id", bookingId);

    if (error) throw error;
    return data;
  }


  async countParticipantsForSession(sessionId: number): Promise<number> {
    // 1) Разовые записи
    const { count: singleCount } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("status", "confirmed");

    // 2) Абонементы (booking_sessions)
    const { count: fullCount } = await supabase
      .from("booking_sessions")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    return (singleCount || 0) + (fullCount || 0);
  }

}