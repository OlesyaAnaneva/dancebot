export interface Booking {
  id: number;
  application_id: number;  // Ссылка на заявку
  program_id: number;
  user_id: number;
  user_name: string;
  user_phone: string;
  amount: number;
  attended: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface BookingWithRelations extends Booking {
  programs?: {
    id: number;
    title: string;
    type: string;
    schedule: string;
    single_price?: number;
    status: string;
  };

  users?: {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
  };
}
