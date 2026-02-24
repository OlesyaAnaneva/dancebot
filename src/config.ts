import dotenv from 'dotenv';
dotenv.config();

// Контактные данные Ани
export const ANNA_INFO = {
  name: 'Анна Карелина',
  phone: '+79156732891',
  telegram: '@anv_karelina',
  telegramGroup: '@avkarelina',
  instagram: '@anv_karelina',
  description: 'Профессиональная танцовщица, преподаватель High Heels',
};

// Информация о студии
export const STUDIO_INFO = {
  name: 'Let\'s dance',
  address: 'ул. Максима Горького, 17/129',
  floor: '2 этаж',
  location: {
    latitude: 52.719397,
    longitude: 41.453504
  },
  rules: {
    important: 'Заклейте подошву туфель тканевым пластырем или черным тейпом, чтобы не оставлять следы на полу',
    cleaning: 'Если следы остались — не беда! Влажными салфетками удаляем после занятия 😉'
  }
};

export const config = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  isDevelopment: process.env.NODE_ENV !== 'production',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
  anna: ANNA_INFO,
  studio: STUDIO_INFO,
  annaTelegramId: process.env.ADMIN_CHAT_ID || '778471230',  
};