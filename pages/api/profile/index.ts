import type { NextApiResponse } from 'next';
import { prisma } from '../../../lib/prisma';
import { withAuth, AuthedRequest } from '../../../lib/withAuth';

async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.userId;

  const [user, entries] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.watchlistEntry.findMany({ where: { userId } }),
  ]);

  if (!user) {
    return res.status(404).json({ error: 'Користувача не знайдено' });
  }

  const byStatus = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  const episodesWatched = entries.reduce((sum, e) => sum + e.currentEpisode, 0);

  const scored = entries.filter((e) => e.score !== null);
  const averageScore = scored.length
    ? scored.reduce((sum, e) => sum + (e.score ?? 0), 0) / scored.length
    : 0;

  const daysWatched = Math.round((episodesWatched * 24) / 60 / 24 * 10) / 10; // ~24 хв/серія, груба оцінка

  return res.status(200).json({
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    totalTitles: entries.length,
    episodesWatched,
    averageScore: Math.round(averageScore * 100) / 100,
    daysWatched,
    byStatus: {
      watching: byStatus.watching ?? 0,
      planned: byStatus.planned ?? 0,
      completed: byStatus.completed ?? 0,
      on_hold: byStatus.on_hold ?? 0,
      dropped: byStatus.dropped ?? 0,
    },
  });
}

export default withAuth(handler);
