import type { NextApiRequest, NextApiResponse } from 'next';
import { lookupPhone } from '../../../lib/telegram';

// GET /api/tg/check?phone=380671234567
// Заголовок X-Access-Key (або ?key=) має збігатися з TG_ACCESS_KEY — щоб ендпоінт
// не міг використовувати хто завгодно (і щоб Telegram не обмежив ваш акаунт).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accessKey = process.env.TG_ACCESS_KEY;
  const given = req.headers['x-access-key'] ?? req.query.key;
  if (!accessKey || given !== accessKey) {
    return res.status(401).json({ error: 'Невірний ключ доступу' });
  }

  const phone = String(req.query.phone ?? '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) {
    return res.status(400).json({ error: 'Некоректний номер' });
  }

  try {
    return res.status(200).json(await lookupPhone(phone));
  } catch (e: any) {
    const msg = String(e?.errorMessage ?? e?.message ?? e);
    if (msg.startsWith('FLOOD')) {
      return res.status(429).json({ error: `Telegram обмежив запити, зачекайте ${e.seconds ?? ''} с` });
    }
    return res.status(500).json({ error: msg });
  }
}
