import { supabase } from '../supabase';

export interface Guide {
  id: number;
  title: string;
  content: string;
  links: Array<{
    title: string;
    url: string;
    price?: string;
    description?: string;
  }>;
  category: string;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class GuideService {
  async getAll(): Promise<Guide[]> {
    const { data, error } = await supabase
      .from('guides')
      .select('*')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async getByCategory(category: string): Promise<Guide[]> {
    const { data, error } = await supabase
      .from('guides')
      .select('*')
      .eq('category', category)
      .eq('is_published', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async getById(id: number): Promise<Guide | null> {
    const { data, error } = await supabase
      .from('guides')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async create(guide: Omit<Guide, 'id' | 'created_at' | 'updated_at'>): Promise<Guide> {
    const { data, error } = await supabase
      .from('guides')
      .insert([guide])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(id: number, updates: Partial<Guide>): Promise<Guide> {
    const { data, error } = await supabase
      .from('guides')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async delete(id: number): Promise<void> {
    const { error } = await supabase
      .from('guides')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  async getShoesGuide(): Promise<Guide | null> {
    const guides = await this.getByCategory('shoes');
    return guides[0] || null;
  }
}