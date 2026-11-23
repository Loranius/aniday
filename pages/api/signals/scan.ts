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
    if (job === 'scalp') {
      const scan = await runScan(job, deps);
      return res.status(200).json({ job, scan });
    }
    // swing: спершу трекінг (швидкий, закриває угоди), потім скан; збій одного не скасовує інше
    let tracking: Awaited<ReturnType<typeof runTracking>> | undefined;
    let scan: Awaited<ReturnType<typeof runScan>> | undefined;
    const errors: string[] = [];
    try {
      tracking = await runTracking(deps);
    } catch (e) {
      console.error('signals/scan tracking error', e);
      errors.push(`tracking: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      scan = await runScan('swing', deps);
    } catch (e) {
      console.error('signals/scan swing error', e);
      errors.push(`scan: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (tracking === undefined && scan === undefined) return res.status(500).json({ error: 'Internal error' });
    return res.status(200).json({ job, tracking, scan, ...(errors.length ? { errors } : {}) });
  } catch (e) {
    console.error('signals/scan error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
