import { describe, it, expect, beforeEach } from 'vitest';
import { runTracking } from '../../lib/signals/track';
import { initialState } from '../../lib/signals/outcome';
import type { Candidate, Candle } from '../../lib/signals/types';
import { FakeRepo, FakeMarket, FakeReviewer, FakeNotifier } from './fakes';

const T0 = 1_700_000_000_000;
const cand: Candidate = {
  mode: 'intraday', symbol: 'SOLUSDT', direction: 'long', timeframe: '15m', candleTs: T0,
  entryLow: 99, entryHigh: 101, stop: 95, tp1: 110, tp2: 120, pattern: 'breakout', metrics: { atr: 1 },
};
const k = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  ts: T0 + i * 60_000, open: o, high: h, low: l, close: c, volume: 1, quoteVolume: 1,
});

let repo: FakeRepo, market: FakeMarket, notifier: FakeNotifier, now: number;
const deps = () => ({ market, repo, reviewer: new FakeReviewer(), notifier, now: () => now });

async function addSignal(group: 'confirmed' | 'shadow', msgId: number | null) {
  const res = await repo.insertSignal({
    ...initialState(cand, 'intraday', T0), dedupeKey: `k-${group}`, mode: 'intraday', group, symbol: 'SOLUSDT',
    timeframe: '15m', pattern: 'breakout', metrics: { atr: 1 }, sizing: {}, claudeReason: null,
  });
  if (msgId !== null) await repo.setMessageId(res!.id, msgId);
  repo.calls.length = 0;
}

beforeEach(() => {
  repo = new FakeRepo(); market = new FakeMarket(); notifier = new FakeNotifier();
  now = T0 + 3_600_000;
  // вхід на свічці 1, TP1 на 2, TP2 на 3
  market.data.SOLUSDT = { '1m': [k(1, 100, 100.5, 99.5, 100), k(2, 100, 111, 100.2, 110), k(3, 110, 121, 109, 120)] };
});

describe('runTracking', () => {
  it('сигнал із свічками до TP2 → closed, повідомлення з replyTo', async () => {
    await addSignal('confirmed', 42);
    const r = await runTracking(deps());
    expect(r).toEqual({ checked: 1, closed: 1, errors: [] });
    expect(repo.signals[0]).toMatchObject({ status: 'closed', closeReason: 'tp2' });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].replyTo).toBe(42);
    expect(notifier.sent[0].text).toContain('TP2');
    expect(market.calls[0]).toMatchObject({ g: '1m', limit: 1000, startTime: T0 + 1 });
  });

  it('shadow закривається без повідомлення', async () => {
    await addSignal('shadow', null);
    const r = await runTracking(deps());
    expect(r.closed).toBe(1);
    expect(repo.signals[0].status).toBe('closed');
    expect(notifier.sent).toHaveLength(0);
  });

  it('проміжок > 16 год → 5m', async () => {
    await addSignal('confirmed', null);
    now = T0 + 17 * 3_600_000;
    market.data.SOLUSDT!['5m'] = [];
    await runTracking(deps());
    expect(market.calls[0].g).toBe('5m');
  });

  it('без нових свічок стан не зберігається', async () => {
    await addSignal('confirmed', null);
    market.data.SOLUSDT!['1m'] = [];
    await runTracking(deps());
    expect(repo.calls).not.toContain('saveTrackState');
  });

  it('помилка по символу збирається, інші обробляються', async () => {
    await addSignal('confirmed', 7);
    await repo.insertSignal({
      ...initialState({ ...cand, symbol: 'ETHUSDT' }, 'intraday', T0), dedupeKey: 'eth', mode: 'intraday',
      group: 'confirmed', symbol: 'ETHUSDT', timeframe: '15m', pattern: 'x', metrics: {}, sizing: {}, claudeReason: null,
    });
    market.failFor.add('ETHUSDT');
    const r = await runTracking(deps());
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^ETHUSDT: /);
    expect(r.closed).toBe(1);
  });
});
