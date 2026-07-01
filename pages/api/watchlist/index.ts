import type { NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { withAuth, AuthedRequest } from '../../../lib/withAuth';

const upsertSchema = z.object({
  animeId: z.number().int().positive(),
  animeTitle: z.string(),
  animeImage: z.string().optional(),
  totalEpisodes: z.number().int().min(0).default(0),
  status: z.enum(['watching', 'planned', 'completed', 'on_hold', 'dropped']).default('planned'),
  currentEpisode: z.number().int().min(0).default(0),
  score: z.number().int().min(1).max(10).optional(),
});

async function handler(req: AuthedRequest, res: NextApiResponse) {
  const userId = req.user.userId;

  if (req.method === 'GET') {
    const { status } = req.query;
    const entries = await prisma.watchlistEntry.findMany({
      where: {
        userId,
        ...(typeof status === 'string' ? { status: status as any } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return res.status(200).json(entries);
  }

  if (req.method === 'POST') {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Невалідні дані', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // upsert по унікальній парі (userId, animeId) — один тайтл на юзера
    const entry = await prisma.watchlistEntry.upsert({
      where: { userId_animeId: { userId, animeId: data.animeId } },
      create: { ...data, userId },
      update: {
        status: data.status,
        currentEpisode: data.currentEpisode,
        totalEpisodes: data.totalEpisodes,
        score: data.score,
        animeTitle: data.animeTitle,
        animeImage: data.animeImage,
      },
    });
    return res.status(200).json(entry);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
