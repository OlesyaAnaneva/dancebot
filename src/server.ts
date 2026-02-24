import express, { Request, Response } from 'express';
import { createBot } from './bot';

const app = express();
const bot = createBot();

// Парсинг JSON
app.use(express.json());

// Webhook endpoint
app.post('/api/bot', (req: Request, res: Response) => {
  try {
    bot.getBot().processUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/bot', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'Bot alive' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});