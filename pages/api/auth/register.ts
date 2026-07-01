import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { hashPassword, signToken } from '../../../lib/auth';

const schema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(100),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Невалідні дані', details: parsed.error.flatten() });
  }
  const { username, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ error: 'Користувач з таким іменем вже існує' });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, passwordHash },
  });

  const token = signToken({ userId: user.id, username: user.username });
  return res.status(201).json({
    token,
    user: { id: user.id, username: user.username },
  });
}
