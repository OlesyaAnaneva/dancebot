export interface Program {
  id: number;
  type: 'group' | 'intensive' | 'open_group' | 'individual';
  title: string;
  description: string;
  start_date: string;
  end_date?: string;
  schedule?: string;
  max_participants: number;
  current_participants: number;
  price: number;
  single_price?: number | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  duration_minutes: string;
  group_link?: string | null;
}