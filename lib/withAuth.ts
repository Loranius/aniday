import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser, JwtPayload } from './auth';

export type AuthedRequest = NextApiRequest & { user: JwtPayload };

export function withAuth(
  handler: (req: AuthedRequest, res: NextApiResponse) => unknown
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Потрібна авторизація' });
      return;
    }
    (req as AuthedRequest).user = user;
    return handler(req as AuthedRequest, res);
  };
}
