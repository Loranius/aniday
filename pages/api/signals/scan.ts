import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { maxDuration: 60 };

// GET|POST /api/signals/scan?job=scalp|swing — cron-ендпоінт (Authorization: Bearer CRON_SECRET)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const job = req.query.job;
  if (job !== 'scalp' && job !== 'swing') return res.status(400).json({ error: 'job must be scalp or swing' });

  try {
    // ліниво: БД, Anthropic і Telegram — лише після авторизації
    const [{ default: Anthropic }, { signalsEnv }, { createBitget }, { signalsRepo }, { createClaudeReviewer }, { createTelegram }, { runScan }, { runTracking }] =
      await Promise.all([
        import('@anthropic-ai/sdk'),
        import('../../../lib/signals/env'),
        import('../../../lib/signals/bitget'),
        import('../../../lib/signals/repo'),
        import('../../../lib/signals/claude'),
        import('../../../lib/signals/telegram'),
        import('../../../lib/signals/scan'),
        import('../../../lib/signals/track'),
      ]);
    const env = signalsEnv();
    const deps = {
      market: createBitget(),
      repo: signalsRepo,
      reviewer: createClaudeReviewer(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
      notifier: createTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_OWNER_ID),
      now: () => Date.now(),
    };
    const scan = await runScan(job, deps);
    if (job === 'scalp') return res.status(200).json({ job, scan });
    const tracking = await runTracking(deps);
    return res.status(200).json({ job, scan, tracking });
  } catch (e) {
    console.error('signals/scan error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
