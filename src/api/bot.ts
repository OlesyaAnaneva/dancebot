import { createBot } from '../bot';

const bot = createBot();

export default async function handler(req: any, res: any) {
  if (req.method === 'POST') {
    try {
      bot.getBot().processUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(200).json({ status: 'Bot alive' });
}