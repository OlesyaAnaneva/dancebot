import { createBot } from './bot/index';
import { Logger } from './utils/logger';

// Запускаем бота
Logger.info('🚀 Запуск бота Ани Карелиной...');
Logger.info(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
Logger.info(`🌐 Вебхук: ${process.env.NODE_ENV === 'production' ? 'включен' : 'выключен'}`);

// Создаем и экспортируем экземпляр бота
const bot = (() => {
  try {
    const instance = createBot();
    Logger.success('✅ Бот успешно запущен');
    return instance;
  } catch (error) {
    Logger.error('💥 Критическая ошибка при запуске бота:', error);
    process.exit(1);
  }
})();

export { bot };
export default bot;