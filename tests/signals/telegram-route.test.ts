import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/signals/commands', () => ({ handleUpdate: vi.fn().mockResolvedValue(undefined) }));
import { handleUpdate } from '../../lib/signals/commands';
import handler from '../../pages/api/signals/telegram';

const ENV = {
  SIGNALS_DATABASE_URL: 'postgresql://a', SIGNALS_DIRECT_URL: 'postgresql://b', TELEGRAM_BOT_TOKEN: 't',
  TELEGRAM_OWNER_ID: '1', TELEGRAM_WEBHOOK_SECRET: 'sec', CRON_SECRET: 'c', ANTHROPIC_API_KEY: 'k',
};
function mkRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
beforeEach(() => { Object.assign(process.env, ENV); vi.mocked(handleUpdate).mockClear(); });

describe('POST /api/signals/telegram', () => {
  it('неправильний секрет → 401', async () => {
    const res = mkRes();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'bad' }, body: {} } as any, res);
    expect(res.statusCode).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });
  it('без заголовка → 401', async () => {
    const res = mkRes();
    await handler({ method: 'POST', headers: {}, body: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it('не POST → 405', async () => {
    const res = mkRes();
    await handler({ method: 'GET', headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });
  it('правильний секрет → 200 і handleUpdate', async () => {
    const res = mkRes();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec' }, body: { a: 1 } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });
  it('помилка обробки → все одно 200', async () => {
    vi.mocked(handleUpdate).mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec' }, body: {} } as any, res);
    expect(res.statusCode).toBe(200);
    spy.mockRestore();
  });
});
