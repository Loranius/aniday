import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/signals/strategies/scalp', () => ({ detectScalp: vi.fn() }));
import { detectScalp } from '../../lib/signals/strategies/scalp';
import { runScan } from '../../lib/signals/scan';
import { kyivDayStartMs } from '../../lib/signals/budget';
import type { Candidate, Candle, Ticker } from '../../lib/signals/types';
import { FakeRepo, FakeMarket, FakeReviewer, FakeNotifier } from './fakes';

const T0 = 1_700_000_000_000;
const candles = (n: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ ts: T0 + i * step, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1, quoteVolume: 100 }));
const tk = (symbol: string): Ticker => ({ symbol, last: 100, quoteVolume24h: 9e9, change24h: 0, fundingRate: 0, openInterest: 1 });
const cand = (symbol: string, candleTs: number): Candidate => ({
  mode: 'scalp', symbol, direction: 'long', timeframe: '5m', candleTs, entryLow: 99.9, entryHigh: 100.1,
  stop: 99.5, tp1: 100.5, tp2: null, pattern: 'breakout', metrics: { atr: 0.3 },
});

let repo: FakeRepo, market: FakeMarket, reviewer: FakeReviewer, notifier: FakeNotifier, now: number;
const deps = () => ({ market, repo, reviewer, notifier, now: () => now });

beforeEach(() => {
  repo = new FakeRepo(); market = new FakeMarket(); reviewer = new FakeReviewer(); notifier = new FakeNotifier();
  now = T0 + 10 * 3_600_000;
  market.tickerList = [tk('SOLUSDT')];
  market.data.SOLUSDT = { '5m': candles(100, 300_000), '1m': candles(60, 60_000) };
  vi.mocked(detectScalp).mockReset();
  vi.mocked(detectScalp).mockReturnValue(cand('SOLUSDT', T0 + 99 * 300_000));
});

describe('runScan scalp з кандидатом', () => {
  it('confirm → сигнал scalp з ризиком 1%', async () => {
    const r = await runScan('scalp', deps());
    expect(r[0]).toMatchObject({ mode: 'scalp', candidates: 1, sent: 1 });
    expect(repo.signals[0].group).toBe('confirmed');
    expect(notifier.sent[0].text).toContain('(1%)');
    expect(repo.snapshots).toHaveLength(0); // снапшоти лише в swing
  });

  it('скальп-ліміт досягнуто → кандидат пропущено', async () => {
    repo.settings.scalpDailyLimit = 1;
    await repo.insertSignal({
      status: 'pending', direction: 'long', entryLow: 1, entryHigh: 2, stop: 0.5, tp1: 3, tp2: null,
      createdAt: kyivDayStartMs(now) + 1, entryDeadline: now, filledAt: null, fillPrice: null, tp1Hit: false,
      timeoutAt: null, closedAt: null, closeReason: null, resultR: null, lastCheckedTs: 0,
      dedupeKey: 'other', mode: 'scalp', group: 'confirmed', symbol: 'ETHUSDT', timeframe: '5m', pattern: 'x',
      metrics: {}, sizing: {}, claudeReason: null,
    });
    const r = await runScan('scalp', deps());
    expect(r[0]).toMatchObject({ candidates: 1, sent: 0, skipped: 1 });
    expect(reviewer.calls).toHaveLength(0);
    expect(repo.signals).toHaveLength(1);
  });

  it('paused: [scalp] → кандидат відкинуто', async () => {
    repo.settings.paused = ['scalp'];
    const r = await runScan('scalp', deps());
    expect(r[0]).toMatchObject({ candidates: 1, sent: 0, skipped: 1 });
    expect(repo.signals).toHaveLength(0);
    expect(reviewer.calls).toHaveLength(0);
  });
});
