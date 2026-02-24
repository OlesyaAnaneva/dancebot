export interface Application {
  id: number;
  program_id: number;
  user_id?: number;
  user_name: string;
  user_phone: string;
  user_notes?: string;
  payment_method?: string;
  payment_proof?: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  admin_notes?: string;
  created_at: string;
  updated_at: string;
  session_id?: number | null;
  session_ids?: number[] | null;

}

export interface ApplicationWithRelations extends Application {
  programs?: {
    id: number;
    title: string;
    type: string;
    price: number;
    max_participants: number;
    current_participants: number;
    start_date?: string;
    schedule?: string;
    group_link?: string;
  };
  users?: {
    telegram_id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}