import { describe, it, expect, beforeEach } from 'vitest';
import { runScan } from '../../lib/signals/scan';
import type { Candle, Ticker } from '../../lib/signals/types';
import { FakeRepo, FakeMarket, FakeReviewer, FakeNotifier } from './fakes';

const T0 = 1_700_000_000_000;
function makeCandles(closes: number[], step: number, wick = 0.2, vol = 100): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      ts: T0 + i * step, open, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick,
      close, volume: vol, quoteVolume: vol * close,
    };
  });
}
const noise = (n: number) => Array.from({ length: n }, (_, i) => 100 + 0.3 * Math.sin(i * 0.9));
const withLast = (c: Candle[], patch: Partial<Candle>) => [...c.slice(0, -1), { ...c[c.length - 1], ...patch }];
// ті самі дані, що дають long-breakout у strategies.test.ts
const c1h = () => makeCandles(Array.from({ length: 250 }, (_, i) => 100 + i * 0.5), 3_600_000);
const breakout15 = () =>
  withLast(makeCandles(noise(80), 900_000), { open: 100.7, close: 101, high: 101.05, low: 100.65, volume: 400 });

const tk = (symbol: string, vol: number): Ticker => ({
  symbol, last: 101, quoteVolume24h: vol, change24h: 0.01, fundingRate: 0, openInterest: 1000,
});

let repo: FakeRepo, market: FakeMarket, reviewer: FakeReviewer, notifier: FakeNotifier, now: number;
const deps = () => ({ market, repo, reviewer, notifier, now: () => now });

beforeEach(() => {
  repo = new FakeRepo();
  market = new FakeMarket();
  reviewer = new FakeReviewer();
  notifier = new FakeNotifier();
  const c15 = breakout15();
  now = c15[c15.length - 1].ts + 900_000;
  market.tickerList = [tk('BTCUSDT', 9e9), tk('SOLUSDT', 8e9)];
  market.data.SOLUSDT = { '15m': c15, '1H': c1h() };
  // BTC: пласкі дані без сетапу
  market.data.BTCUSDT = { '15m': makeCandles(new Array(80).fill(100), 900_000), '1H': c1h() };
});

const intraday = (r: Awaited<ReturnType<typeof runScan>>) => r.find((x) => x.mode === 'intraday')!;

describe('runScan swing', () => {
  it('confirm → 1 confirmed сигнал, 1 повідомлення, messageId збережено', async () => {
    const r = await runScan('swing', deps());
    expect(intraday(r)).toMatchObject({ candidates: 1, sent: 1, shadow: 0, errors: [] });
    expect(repo.signals).toHaveLength(1);
    expect(repo.signals[0]).toMatchObject({ symbol: 'SOLUSDT', group: 'confirmed', mode: 'intraday', claudeReason: 'ок' });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].text).toContain('SOLUSDT');
    expect(notifier.sent[0].text).toContain('(2%)'); // riskPct режиму
    expect(repo.signals[0].telegramMessageId).toBe(100);
    expect(market.tickerCalls).toBe(1);
    expect(repo.snapshots).toHaveLength(1);
    const day = Object.keys(repo.spend)[0];
    expect(repo.spend[day]).toBeCloseTo(0.01);
  });

  it('reject → shadow, без повідомлень; наступний confirm на новій свічці не блокується', async () => {
    reviewer.review_ = { decision: 'reject', reason: 'слабо' };
    const r = await runScan('swing', deps());
    expect(intraday(r)).toMatchObject({ candidates: 1, sent: 0, shadow: 1 });
    expect(repo.signals[0].group).toBe('shadow');
    expect(notifier.sent).toHaveLength(0);

    // нова свічка → новий dedupeKey
    const c15 = breakout15().map((k) => ({ ...k, ts: k.ts + 900_000 }));
    market.data.SOLUSDT!['15m'] = c15;
    now += 900_000;
    reviewer.review_ = { decision: 'confirm', reason: 'ок' };
    await runScan('swing', deps());
    expect(repo.signals.map((s) => s.group)).toEqual(['shadow', 'confirmed']);
    expect(notifier.sent).toHaveLength(1);
  });

  it('бюджет вичерпано → no_claude, reviewer не викликано', async () => {
    repo.spendOverride = 20;
    await runScan('swing', deps());
    expect(reviewer.calls).toHaveLength(0);
    expect(repo.signals[0].group).toBe('no_claude');
    expect(repo.signals[0].claudeReason).toBeNull();
    expect(notifier.sent[0].text).toContain('без перевірки Claude');
  });

  it('unavailable → no_claude', async () => {
    reviewer.review_ = { decision: 'unavailable', error: 'x' };
    await runScan('swing', deps());
    expect(repo.signals[0].group).toBe('no_claude');
    expect(notifier.sent).toHaveLength(1);
  });

  it('два запуски поспіль з тими самими даними → 1 сигнал, 1 повідомлення', async () => {
    await runScan('swing', deps());
    await runScan('swing', deps());
    expect(repo.signals).toHaveLength(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it('дубль shadow (той самий dedupeKey) не створює другого рядка', async () => {
    reviewer.review_ = { decision: 'reject', reason: 'x' };
    await runScan('swing', deps());
    const r = await runScan('swing', deps());
    expect(repo.signals).toHaveLength(1);
    expect(intraday(r).shadow).toBe(0);
  });

  it('помилка market.candles для BTCUSDT не зупиняє SOLUSDT', async () => {
    market.failFor.add('BTCUSDT');
    const r = await runScan('swing', deps());
    expect(intraday(r).errors).toHaveLength(1);
    expect(intraday(r).errors[0]).toMatch(/^BTCUSDT: /);
    expect(repo.signals).toHaveLength(1);
    expect(repo.signals[0].symbol).toBe('SOLUSDT');
  });

  it('paused: [intraday] → інтрадей пропущено', async () => {
    repo.settings.paused = ['intraday'];
    const r = await runScan('swing', deps());
    expect(r.find((x) => x.mode === 'intraday')).toBeUndefined();
    expect(repo.signals).toHaveLength(0);
    expect(market.calls.some((c) => c.g === '1H')).toBe(false);
  });

  it('активний сигнал по тій самій монеті й напряму → пропуск без рецензії', async () => {
    await runScan('swing', deps());
    reviewer.calls.length = 0;
    const c15 = breakout15().map((k) => ({ ...k, ts: k.ts + 900_000 }));
    market.data.SOLUSDT!['15m'] = c15;
    const r = await runScan('swing', deps());
    expect(reviewer.calls).toHaveLength(0);
    expect(intraday(r).skipped).toBe(1);
  });

  it('коригований Claude стоп перераховує tp1/tp2 від R', async () => {
    const base = await (async () => { await runScan('swing', deps()); return repo.signals[0]; })();
    const mid = (base.entryLow + base.entryHigh) / 2;
    const newStop = mid - (mid - base.stop) * 0.8;
    repo = new FakeRepo();
    reviewer.review_ = { decision: 'confirm', reason: 'ок', stop: newStop };
    await runScan('swing', deps());
    const s = repo.signals[0];
    const R = mid - newStop;
    expect(s.stop).toBeCloseTo(newStop);
    expect(s.tp1).toBeCloseTo(mid + 1.5 * R, 6);
    expect(s.tp2).toBeCloseTo(mid + 3 * R, 6);
  });

  it('не більше maxReviewsPerRun рецензій; решта в skipped', async () => {
    const syms = Array.from({ length: 8 }, (_, i) => `COIN${i}USDT`);
    market.tickerList = syms.map((s) => tk(s, 9e9));
    for (const s of syms) market.data[s] = { '15m': breakout15(), '1H': c1h() };
    const r = await runScan('swing', deps());
    expect(reviewer.calls).toHaveLength(5);
    expect(intraday(r)).toMatchObject({ candidates: 8, sent: 5, skipped: 3 });
  });
});

describe('runScan scalp', () => {
  it('без кандидатів → жодного виклику repo', async () => {
    market.data.SOLUSDT = { '5m': makeCandles(new Array(100).fill(100), 300_000), '1m': makeCandles(new Array(60).fill(100), 60_000) };
    market.data.BTCUSDT = market.data.SOLUSDT;
    const r = await runScan('scalp', deps());
    expect(repo.calls).toEqual([]);
    expect(r).toEqual([{ mode: 'scalp', candidates: 0, sent: 0, shadow: 0, skipped: 0, errors: [] }]);
    expect(market.calls.some((c) => c.g === '5m' && c.limit === 100)).toBe(true);
    expect(market.calls.some((c) => c.g === '1m' && c.limit === 60)).toBe(true);
  });
});
