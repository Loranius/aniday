import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/signals/scan';

function mkRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
beforeEach(() => { process.env.CRON_SECRET = 'cron'; });

describe('/api/signals/scan', () => {
  it('без Authorization → 401', async () => {
    const res = mkRes();
    await handler({ method: 'GET', headers: {}, query: { job: 'swing' } } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it('неправильний bearer → 401', async () => {
    const res = mkRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: { job: 'swing' } } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it('CRON_SECRET не задано → 401', async () => {
    delete process.env.CRON_SECRET;
    const res = mkRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer undefined' }, query: { job: 'swing' } } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it('невалідний job → 400', async () => {
    const res = mkRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer cron' }, query: { job: 'x' } } as any, res);
    expect(res.statusCode).toBe(400);
  });
  it('метод не GET/POST → 405', async () => {
    const res = mkRes();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer cron' }, query: { job: 'swing' } } as any, res);
    expect(res.statusCode).toBe(405);
  });
});
