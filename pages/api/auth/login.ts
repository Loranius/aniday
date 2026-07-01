import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { verifyPassword, signToken } from '../../../lib/auth';

const schema = z.object({
  username: z.string(),
  password: z.string(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Невалідні дані' });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.passwordHash) {
    // Навмисно та сама помилка, що і при невірному паролі — не палимо, чи існує юзернейм,
    // і не видаємо, що акаунт зареєстрований через Google/Apple
    return res.status(401).json({ error: 'Невірний логін або пароль' });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Невірний логін або пароль' });
  }

  const token = signToken({ userId: user.id, username: user.username });
  return res.status(200).json({
    token,
    user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl },
  });
}
