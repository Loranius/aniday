import { PrismaClient } from '@prisma/client';

// У serverless-середовищі (Vercel) кожен виклик функції може створювати нове
// з'єднання — тому кешуємо клієнт у globalThis, щоб перевикористовувати його
// між викликами в межах одного "теплого" інстансу.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
