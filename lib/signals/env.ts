import { z } from 'zod';

const schema = z.object({
  SIGNALS_DATABASE_URL: z.string().min(1),
  SIGNALS_DIRECT_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_OWNER_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
});

export type SignalsEnv = z.infer<typeof schema>;

// Валідація env бота (викликається лише з API бота, не з AniDay-коду)
export function signalsEnv(): SignalsEnv {
  const r = schema.safeParse(process.env);
  if (r.success) return r.data;
  const missing = r.error.issues.map((i) => i.path.join('.'));
  throw new Error(`Відсутні або порожні змінні середовища бота: ${[...new Set(missing)].join(', ')}`);
}
