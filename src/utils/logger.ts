export class Logger {
  static info(message: string, data?: any): void {
    console.log(`ℹ️  ${new Date().toISOString()} - ${message}`, data || '');
  }

  static warn(message: string, data?: any): void {
    console.warn(`⚠️  ${new Date().toISOString()} - ${message}`, data || '');
  }

  static error(message: string, data?: any): void {
    console.error(`❌ ${new Date().toISOString()} - ${message}`, data || '');
  }

  static success(message: string, data?: any): void {
    console.log(`✅ ${new Date().toISOString()} - ${message}`, data || '');
  }

  static debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`🐛 ${new Date().toISOString()} - ${message}`, data || '');
    }
  }

  static botEvent(event: string, userId?: number, data?: any): void {
    console.log(`🤖 ${new Date().toISOString()} - [${event}] User: ${userId || 'unknown'}`, data || '');
  }
}