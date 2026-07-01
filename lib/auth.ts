import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextApiRequest } from 'next';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Свідомо кидаємо помилку на старті, а не мовчки працюємо з незахищеним токеном
  throw new Error('JWT_SECRET не заданий у змінних середовища');
}

export interface JwtPayload {
  userId: string;
  username: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '30d' });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JwtPayload;
  } catch {
    return null;
  }
}

/** Дістає та перевіряє JWT з заголовка Authorization: Bearer <token> */
export function getAuthUser(req: NextApiRequest): JwtPayload | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return verifyToken(token);
}
