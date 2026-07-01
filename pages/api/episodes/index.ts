import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { withAuth, AuthedRequest } from '../../../lib/withAuth';

const createSchema = z.object({
  animeId: z.number().int().positive(),
  episodeNumber: z.number().int().positive(),
  videoUrl: z.string().url(),
  duration: z.number().int().positive().optional(),
});

async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const animeId = Number(req.query.animeId);
    if (!Number.isInteger(animeId)) {
      return res.status(400).json({ error: 'animeId має бути числом' });
    }
    const episodes = await prisma.episode.findMany({
      where: { animeId },
      orderBy: { episodeNumber: 'asc' },
    });
    return res.status(200).json(episodes);
  }

  if (req.method === 'POST') {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Невалідні дані', details: parsed.error.flatten() });
    }
    const episode = await prisma.episode.upsert({
      where: {
        animeId_episodeNumber: {
          animeId: parsed.data.animeId,
          episodeNumber: parsed.data.episodeNumber,
        },
      },
      create: parsed.data,
      update: { videoUrl: parsed.data.videoUrl, duration: parsed.data.duration },
    });
    return res.status(200).json(episode);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

// GET залишаємо без авторизації (просто перегляд списку серій),
// а POST захищаємо, щоб додавати відео міг тільки залогінений користувач
export default async function routeHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handler(req as AuthedRequest, res);
  }
  return withAuth(handler)(req, res);
}

