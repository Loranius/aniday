import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/auth';

// Client ID з Google Cloud Console (OAuth 2.0 Client IDs) — потрібен, щоб
// перевірити, що токен виданий саме для вашого застосунку, а не для чужого
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID не заданий у змінних середовища');
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const schema = z.object({
  idToken: z.string(), // токен, отриманий застосунком від Google Sign-In
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Відсутній idToken' });
  }

  let payload;
  try {
    // КРИТИЧНО: перевіряємо підпис токена саме тут, на сервері.
    // Ніколи не довіряємо даним (email, ім'я), які клієнт міг би підмінити.
    const ticket = await client.verifyIdToken({
      idToken: parsed.data.idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Невалідний Google-токен' });
  }

  if (!payload?.sub || !payload.email) {
    return res.status(401).json({ error: 'Google не повернув потрібні дані' });
  }

  const providerId = payload.sub;
  const email = payload.email;

  // Шукаємо існуючого користувача саме по (provider, providerId) —
  // це стабільний ідентифікатор, на відміну від email, який теоретично може змінитись
  let user = await prisma.user.findUnique({
    where: { provider_providerId: { provider: 'google', providerId } },
  });

  if (!user) {
    // Генеруємо унікальний username на основі email, з фолбеком при колізії
    const baseUsername = email.split('@')[0].slice(0, 24);
    let username = baseUsername;
    let suffix = 0;
    while (await prisma.user.findUnique({ where: { username } })) {
      suffix += 1;
      username = `${baseUsername}${suffix}`;
    }

    user = await prisma.user.create({
      data: {
        username,
        email,
        provider: 'google',
        providerId,
        avatarUrl: payload.picture,
      },
    });
  }

  const token = signToken({ userId: user.id, username: user.username });
  return res.status(200).json({
    token,
    user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl },
  });
}
