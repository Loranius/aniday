import type { NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { withAuth, AuthedRequest } from '../../../lib/withAuth';

const patchSchema = z.object({
  currentEpisode: z.number().int().min(0).optional(),
  status: z.enum(['watching', 'planned', 'completed', 'on_hold', 'dropped']).optional(),
  score: z.number().int().min(1).max(10).optional(),
});

async function handler(req: AuthedRequest, res: NextApiResponse) {
  const userId = req.user.userId;
  const animeId = Number(req.query.animeId);

  if (!Number.isInteger(animeId)) {
    return res.status(400).json({ error: 'animeId має бути числом' });
  }

  const existing = await prisma.watchlistEntry.findUnique({
    where: { userId_animeId: { userId, animeId } },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Запис не знайдено' });
  }

  if (req.method === 'PATCH') {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Невалідні дані' });
    }
    const updated = await prisma.watchlistEntry.update({
      where: { userId_animeId: { userId, animeId } },
      data: parsed.data,
    });
    return res.status(200).json(updated);
  }

  if (req.method === 'DELETE') {
    await prisma.watchlistEntry.delete({ where: { userId_animeId: { userId, animeId } } });
    return res.status(204).end();
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
