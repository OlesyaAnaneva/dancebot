export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,20}$/;
  return phoneRegex.test(phone);
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function sanitizeText(text: string, maxLength = 1000): string {
  return text.slice(0, maxLength).trim();
}

export function validateAmount(amount: number): boolean {
  return amount > 0 && amount <= 1000000; // Максимум 1 млн рублей
}