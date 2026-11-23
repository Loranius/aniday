import { describe, it, expect, beforeEach, vi } from 'vitest';

const order: string[] = [];
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }));
vi.mock('../../lib/signals/env', () => ({
  signalsEnv: () => ({ ANTHROPIC_API_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_OWNER_ID: '1' }),
}));
vi.mock('../../lib/signals/bitget', () => ({ createBitget: () => ({}) }));
vi.mock('../../lib/signals/repo', () => ({ signalsRepo: {} }));
vi.mock('../../lib/signals/claude', () => ({ createClaudeReviewer: () => ({}) }));
vi.mock('../../lib/signals/telegram', () => ({ createTelegram: () => ({}) }));
vi.mock('../../lib/signals/scan', () => ({ runScan: vi.fn() }));
vi.mock('../../lib/signals/track', () => ({ runTracking: vi.fn() }));

import handler from '../../pages/api/signals/scan';
import { runScan } from '../../lib/signals/scan';
import { runTracking } from '../../lib/signals/track';

function mkRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
const req = (job: string) => ({ method: 'GET', headers: { authorization: 'Bearer cron' }, query: { job } }) as any;

beforeEach(() => {
  process.env.CRON_SECRET = 'cron';
  order.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(runTracking).mockReset().mockImplementation(async () => { order.push('tracking'); return { checked: 1, closed: 0, errors: [] }; });
  vi.mocked(runScan).mockReset().mockImplementation(async () => { order.push('scan'); return []; });
});

describe('/api/signals/scan job=swing', () => {
  it('трекінг виконується ПЕРШИМ, потім скан', async () => {
    const res = mkRes();
    await handler(req('swing'), res);
    expect(order).toEqual(['tracking', 'scan']);
    expect(vi.mocked(runScan).mock.calls[0][0]).toBe('swing');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ job: 'swing', tracking: { checked: 1 }, scan: [] });
  });
  it('збій трекінгу не пропускає скан; 200 з errors', async () => {
    vi.mocked(runTracking).mockRejectedValue(new Error('db'));
    const res = mkRes();
    await handler(req('swing'), res);
    expect(runScan).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.errors).toEqual(['tracking: db']);
    expect(res.body.scan).toEqual([]);
  });
  it('збій скану не втрачає результат трекінгу; 200 з errors', async () => {
    vi.mocked(runScan).mockRejectedValue(new Error('boom'));
    const res = mkRes();
    await handler(req('swing'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.tracking).toMatchObject({ checked: 1 });
    expect(res.body.errors).toEqual(['scan: boom']);
  });
  it('обидва впали → 500', async () => {
    vi.mocked(runTracking).mockRejectedValue(new Error('a'));
    vi.mocked(runScan).mockRejectedValue(new Error('b'));
    const res = mkRes();
    await handler(req('swing'), res);
    expect(res.statusCode).toBe(500);
  });
  it('scalp не запускає трекінг', async () => {
    const res = mkRes();
    await handler(req('scalp'), res);
    expect(runTracking).not.toHaveBeenCalled();
    expect(vi.mocked(runScan).mock.calls[0][0]).toBe('scalp');
    expect(res.statusCode).toBe(200);
  });
});
