import type { NextApiRequest, NextApiResponse } from 'next';
import { handleUpdate } from '../../../lib/signals/commands';
import { createTelegram } from '../../../lib/signals/telegram';
import { signalsEnv } from '../../../lib/signals/env';

export const config = { maxDuration: 60 };

// POST /api/signals/telegram — webhook Telegram. Завжди 200 після авторизації,
// щоб Telegram не повторював доставку.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const env = signalsEnv();
    const { signalsRepo } = await import('../../../lib/signals/repo'); // ліниво: БД лише коли потрібна
    await handleUpdate(req.body, {
      repo: signalsRepo,
      notifier: createTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_OWNER_ID),
      ownerId: env.TELEGRAM_OWNER_ID,
      now: () => Date.now(),
    });
  } catch (e) {
    console.error('signals/telegram webhook error', e);
  }
  return res.status(200).json({ ok: true });
}
