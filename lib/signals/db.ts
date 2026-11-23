import { PrismaClient } from './generated';

// Окремий клієнт для БД бота (Supabase). Кешуємо у globalThis, як lib/prisma.ts.
const globalForSignals = globalThis as unknown as { signalsPrisma?: PrismaClient };

export const signalsPrisma =
  globalForSignals.signalsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForSignals.signalsPrisma = signalsPrisma;
}
