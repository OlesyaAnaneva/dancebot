import { supabase } from '../supabase';
import { Application, ApplicationWithRelations } from '../models/Application';

export class ApplicationService {
  async create(data: Omit<Application, 'id' | 'created_at' | 'updated_at'>): Promise<Application | null> {
    const { data: application } = await supabase
      .from('applications')
      .insert({
        ...data,
        status: 'pending',
        session_ids: data.session_ids || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    return application as Application | null;
  }

  async getPending(): Promise<ApplicationWithRelations[]> {
    const { data } = await supabase
      .from('applications')
      .select(`
        *,
        programs:programs(id, title, type, price, max_participants, current_participants),
        users:users(telegram_id, username)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return data as ApplicationWithRelations[] || [];
  }

  async getById(id: number): Promise<ApplicationWithRelations | null> {
    // First do a plain select to get the application row (avoids relation alias issues)
    const { data: appRow, error: appErr } = await supabase
      .from('applications')
      .select(`
      *,
      programs (*)
    `)
      .eq('id', id)
      .single();

    if (appErr || !appRow) {
      if (appErr) console.warn('ApplicationService.getById: plain select error', appErr);
      return null;
    }

    const application = appRow as ApplicationWithRelations;

    // Fetch program relation separately
    try {
      const { data: prog } = await supabase
        .from('programs')
        .select('id, title, type, price, max_participants, current_participants')
        .eq('id', (application as any).program_id)
        .single();

      if (prog) application.programs = prog as any;
    } catch (e) {
      console.warn('ApplicationService.getById: failed to fetch program relation', e);
    }

    // Fetch user relation separately (if user_id exists)
    if ((application as any).user_id) {
      try {
        const { data: user } = await supabase
          .from('users')
          .select('telegram_id, username, first_name, last_name')
          .eq('id', (application as any).user_id)
          .single();

        if (user) application.users = user as any;
      } catch (e) {
        console.warn('ApplicationService.getById: failed to fetch user relation', e);
      }
    }

    return application as ApplicationWithRelations;
  }

  async updateStatus(id: number, status: Application['status'], adminNotes?: string): Promise<Application | null> {
    const { data, error } = await supabase
      .from('applications')
      .update({
        status,
        admin_notes: adminNotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating application status:', error);
      return null;
    }

    return data as Application | null;
  }

  async getStats(): Promise<{
    total: number;
    pending: number;
    approved: number;
    paid: number;
    rejected: number;
    totalAmount: number;
  }> {
    const { data } = await supabase
      .from('applications')
      .select('*');

    if (!data) {
      return { total: 0, pending: 0, approved: 0, paid: 0, rejected: 0, totalAmount: 0 };
    }

    const total = data.length;
    const pending = data.filter(a => a.status === 'pending').length;
    const approved = data.filter(a => a.status === 'approved').length;
    const paid = data.filter(a => a.status === 'paid').length;
    const rejected = data.filter(a => a.status === 'rejected').length;
    const totalAmount = data.reduce((sum, app) => sum + (app.amount || 0), 0);

    return { total, pending, approved, paid, rejected, totalAmount };
  }

  async getUserApplications(userId: number): Promise<ApplicationWithRelations[]> {
    const { data } = await supabase
      .from('applications')
      .select(`
        *,
        programs:programs(id, title, type, start_date, end_date)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return data as ApplicationWithRelations[] || [];
  }

  async getPendingByUserId(userId: number) {
    const { data, error } = await supabase
      .from("applications")
      .select("*, programs(*)")
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw error;
    return data || [];
  }

  async attachSelectedSessions(bookingId: number, sessionIds: number[]) {

    console.log("🔥 attachSelectedSessions:", bookingId, sessionIds);

    const inserts = sessionIds.map(id => ({
      booking_id: bookingId,
      session_id: id
    }));

    const { error } = await supabase
      .from("booking_sessions")
      .insert(inserts);

    if (error) {
      console.error("❌ booking_sessions insert error:", error);
      throw error;
    }

    console.log("✅ booking_sessions inserted!");
  }


}