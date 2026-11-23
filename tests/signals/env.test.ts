import { describe, it, expect, afterEach } from 'vitest';
import { signalsEnv } from '../../lib/signals/env';

const FULL: Record<string, string> = {
  SIGNALS_DATABASE_URL: 'postgresql://a',
  SIGNALS_DIRECT_URL: 'postgresql://b',
  TELEGRAM_BOT_TOKEN: 't',
  TELEGRAM_OWNER_ID: '123',
  TELEGRAM_WEBHOOK_SECRET: 's',
  CRON_SECRET: 'c',
  ANTHROPIC_API_KEY: 'k',
};
const saved = { ...process.env };

function setEnv(e: Record<string, string>) {
  for (const k of Object.keys(FULL)) delete process.env[k];
  Object.assign(process.env, e);
}

afterEach(() => {
  process.env = { ...saved };
});

describe('signalsEnv', () => {
  it('повертає значення, коли все задано', () => {
    setEnv(FULL);
    const e = signalsEnv();
    expect(e.TELEGRAM_OWNER_ID).toBe('123');
    expect(e.CRON_SECRET).toBe('c');
  });

  it('відсутній TELEGRAM_OWNER_ID → помилка з його назвою', () => {
    const { TELEGRAM_OWNER_ID, ...rest } = FULL;
    setEnv(rest);
    expect(() => signalsEnv()).toThrow(/TELEGRAM_OWNER_ID/);
  });

  it('перелічує всі відсутні змінні', () => {
    setEnv({});
    expect(() => signalsEnv()).toThrow(/SIGNALS_DATABASE_URL.*CRON_SECRET|CRON_SECRET.*SIGNALS_DATABASE_URL/s);
  });
});
