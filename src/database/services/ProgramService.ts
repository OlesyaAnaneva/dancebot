import { supabase } from '../supabase';
import { Program } from '../models/Program';

export class ProgramService {
  async getAllActive(): Promise<Program[]> {
    const { data } = await supabase
      .from("programs")
      .select("*")
      .neq("status", "deleted")
      .order("start_date", { ascending: true });

    return data as Program[] || [];
  }


  async getById(id: number): Promise<Program | null> {
    const { data } = await supabase
      .from('programs')
      .select('*')
      .eq('id', id)
      .single();

    return data as Program | null;
  }

  async getByType(type: Program['type']): Promise<Program[]> {
    const { data } = await supabase
      .from('programs')
      .select('*')
      .eq('type', type)
      .eq('status', 'active')
      .order('start_date', { ascending: true });

    return data as Program[] || [];
  }

  async incrementParticipants(programId: number): Promise<void> {
    const program = await this.getById(programId);
    if (!program) return;

    const newCount = Math.min(
      program.current_participants + 1,
      program.max_participants
    );

    await supabase
      .from('programs')
      .update({
        current_participants: newCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', programId);
  }

  async decrementParticipants(programId: number): Promise<void> {
    const program = await this.getById(programId);
    if (!program) return;

    const newCount = Math.max(program.current_participants - 1, 0);

    await supabase
      .from('programs')
      .update({
        current_participants: newCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', programId);
  }

  async createProgram(program: any) {

    // ✅ Удаляем undefined поля
    const cleanPayload: any = {};

    for (const key in program) {
      if (program[key] !== undefined) {
        cleanPayload[key] = program[key];
      }
    }

    console.log("📦 createProgram payload:", cleanPayload);

    const { data, error } = await supabase
      .from("programs")
      .insert(cleanPayload)
      .select()
      .single();

    if (error) {
      console.error("createProgram error:", error);
      throw error;
    }

    return data;
  }

  async deleteProgram(id: number) {
    console.log("🗑 Soft delete program:", id);

    const { data, error } = await supabase
      .from("programs")
      .update({
        status: "deleted",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select(); // 🔥 ВАЖНО

    if (error) {
      console.error("DELETE ERROR:", error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn("⚠️ Программа не найдена или не обновилась:", id);
      throw new Error("Program not updated");
    }

    console.log("✅ Program soft-deleted реально:", data);
  }

  async getSessions(programId: number) {
    const { data, error } = await supabase
      .from("program_sessions")
      .select("*")
      .eq("program_id", programId)
      .order("session_date");

    if (error) {
      console.error("getSessions error:", error);
      return [];
    }

    return data;
  }

  async createSessions(programId: number, sessions: any[]) {
    const { error } = await supabase
      .from("program_sessions")
      .insert(
        sessions.map((s) => ({
          program_id: programId,
          session_date: s.date,
          session_time: s.time,
        }))
      );

    if (error) {
      console.error("createSessions error:", error);
    }
  }

  async getUpcomingSessions() {
    const { data, error } = await supabase
      .from("program_sessions")
      .select(`
      id,
      session_date,
      session_time,
      program:programs(
        id,
        title,
        type,
        schedule,
        duration_minutes,
        price,
        single_price,
        max_participants,
        current_participants
      )
    `)
      .gte("session_date", new Date().toISOString().split("T")[0])
      .order("session_date", { ascending: true });

    if (error) {
      console.error("getUpcomingSessions error:", error);
      return [];
    }

    return data || [];
  }

  async getUpcomingSessionsByProgram(programId: number) {
    const { data } = await supabase
      .from("program_sessions")
      .select("*")
      .eq("program_id", programId)
      .gte("session_date", new Date().toISOString().split("T")[0])
      .order("session_date", { ascending: true });

    return data || [];
  }
  
  async completePastIntensives(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase
      .from('programs')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('type', 'intensive')
      .eq('status', 'active')
      .lt('end_date', today); // end_date < сегодня

    if (error) {
      console.error('Error completing past intensives:', error);
    }
  }


}