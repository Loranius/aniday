import { describe, it, expect } from 'vitest';
import { advance, initialState } from '../../lib/signals/outcome';
import type { Candle, Candidate } from '../../lib/signals/types';

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({
  ts: T0 + i * 15 * MIN, open: o, high: h, low: l, close: cl, volume: 1, quoteVolume: 1,
});
const longCand = (over: Partial<Candidate> = {}): Candidate => ({
  mode: 'intraday', symbol: 'BTCUSDT', direction: 'long', timeframe: '15m', candleTs: T0 - 15 * MIN,
  entryLow: 99, entryHigh: 101, stop: 98, tp1: 103, tp2: 106, pattern: 't', metrics: {}, ...over,
});
const mk = (cand = longCand(), mode: 'scalp' | 'intraday' | 'pump' = 'intraday') =>
  initialState(cand, mode, T0);

describe('initialState', () => {
  it('sets deadline and lastChecked', () => {
    const s = mk();
    expect(s.status).toBe('pending');
    expect(s.entryDeadline).toBe(T0 + 120 * MIN);
    expect(s.lastCheckedTs).toBe(T0 - 15 * MIN);
    expect(s.timeoutAt).toBeNull();
    expect(s.resultR).toBeNull();
  });
});

describe('advance long', () => {
  it('not_filled when zone not touched before deadline', () => {
    const s = advance(mk(), [c(0, 105, 106, 104, 105), c(1, 105, 106, 104, 105)], 'intraday', T0 + 30 * MIN);
    expect(s.status).toBe('pending');
    const s2 = advance(s, [], 'intraday', T0 + 121 * MIN);
    expect(s2.status).toBe('not_filled');
  });
  it('not_filled via late candle', () => {
    const s = advance(mk(), [c(9, 100, 100, 100, 100)], 'intraday', T0 + 9 * 15 * MIN);
    expect(s.status).toBe('not_filled');
  });
  it('touch after deadline does not fill', () => {
    const s = advance(mk(), [c(8, 100, 101, 99.5, 100)], 'intraday', T0 + 8 * 15 * MIN);
    expect(s.status).toBe('open'); // ts == deadline is still allowed
    const s2 = advance(mk(), [c(9, 100, 101, 99.5, 100)], 'intraday', T0 + 9 * 15 * MIN);
    expect(s2.status).toBe('not_filled');
  });
  it('ignores candles at or before the signal candle', () => {
    const old = { ...c(-1, 100, 100, 90, 95) };
    const s = advance(mk(), [old], 'intraday', T0);
    expect(s.status).toBe('pending');
  });
  it('fill then stop = -1R', () => {
    const s = advance(mk(), [c(0, 102, 102, 100, 101), c(1, 101, 101, 97.5, 98)], 'intraday', T0 + 60 * MIN);
    expect(s.status).toBe('closed');
    expect(s.closeReason).toBe('stop');
    expect(s.resultR).toBe(-1);
    expect(s.fillPrice).toBe(100);
    expect(s.filledAt).toBe(T0);
  });
  it('fill candle checks only stop (tp ignored)', () => {
    const s = advance(mk(), [c(0, 102, 104, 100, 103)], 'intraday', T0 + 15 * MIN);
    expect(s.status).toBe('open');
    expect(s.tp1Hit).toBe(false);
    const s2 = advance(mk(), [c(0, 100, 101, 97, 99)], 'intraday', T0 + 15 * MIN);
    expect(s2.closeReason).toBe('stop');
  });
  it('TP1 then return to entry = breakeven +0.75', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 101, 103.5, 101, 103), c(2, 103, 103, 99.9, 100)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('breakeven');
    expect(s.resultR).toBeCloseTo(0.75, 10);
    expect(s.tp1Hit).toBe(true);
  });
  it('TP1 then TP2 = +2.25', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 101, 103.5, 101, 103), c(2, 103, 106.5, 103, 106)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('tp2');
    expect(s.resultR).toBeCloseTo(2.25, 10);
  });
  it('same candle touches stop and tp1 -> stop', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 101, 103.5, 97.5, 100)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('stop');
    expect(s.resultR).toBe(-1);
  });
  it('after TP1, same candle breakeven and TP2 -> breakeven', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 101, 103.5, 101, 103), c(2, 103, 106.5, 99, 100)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('breakeven');
    expect(s.resultR).toBeCloseTo(0.75, 10);
  });
  it('timeout after 3 days closes at candle close', () => {
    const flat = [c(0, 101, 101, 100, 101)];
    const s1 = advance(mk(), flat, 'intraday', T0 + 15 * MIN);
    const tsT = T0 + 4320 * MIN;
    const s2 = advance(s1, [{ ts: tsT, open: 101, high: 102, low: 100.5, close: 101, volume: 1, quoteVolume: 1 }], 'intraday', tsT + 15 * MIN);
    expect(s2.closeReason).toBe('timeout');
    expect(s2.resultR).toBeCloseTo(0.5, 10); // (101-100)/2
    expect(s2.closedAt).toBe(tsT);
  });
  it('timeout candle does not check stop', () => {
    const s1 = advance(mk(), [c(0, 101, 101, 100, 101)], 'intraday', T0 + 15 * MIN);
    const tsT = T0 + 4320 * MIN;
    const s2 = advance(s1, [{ ts: tsT, open: 101, high: 102, low: 90, close: 99, volume: 1, quoteVolume: 1 }], 'intraday', tsT);
    expect(s2.closeReason).toBe('timeout');
    expect(s2.resultR).toBeCloseTo(-0.5, 10);
  });
  it('scalp without tp2: tp1 102.4 -> tp +1.2', () => {
    const cand = longCand({ mode: 'scalp', tp1: 102.4, tp2: null });
    const st = initialState(cand, 'scalp', T0);
    const s = advance(st, [c(0, 101, 101, 100, 101), c(1, 101, 102.5, 101, 102)], 'scalp', T0 + 60 * MIN);
    expect(s.closeReason).toBe('tp');
    expect(s.resultR).toBeCloseTo(1.2, 10);
  });
  it('single batch: entry, TP1, timeout', () => {
    const tsT = T0 + 240 * 0 + 4320 * MIN;
    const batch: Candle[] = [
      c(0, 101, 101, 100, 101),
      c(1, 101, 103.5, 101, 103),
      { ts: tsT, open: 103, high: 104, low: 101, close: 104, volume: 1, quoteVolume: 1 },
    ];
    const s = advance(mk(), batch, 'intraday', tsT + 15 * MIN);
    expect(s.status).toBe('closed');
    expect(s.closeReason).toBe('timeout');
    expect(s.resultR).toBeCloseTo(0.75 + 0.5 * (104 - 100) / 2, 10);
    expect(s.lastCheckedTs).toBe(tsT);
  });
  it('is idempotent and does not mutate input', () => {
    const init = mk();
    const snap = JSON.stringify(init);
    const batch = [c(0, 101, 101, 100, 101), c(1, 101, 101, 100.4, 100.9)];
    const a = advance(init, batch, 'intraday', T0 + 30 * MIN);
    expect(JSON.stringify(init)).toBe(snap);
    const b = advance(a, batch, 'intraday', T0 + 30 * MIN);
    expect(b).toEqual(a);
    expect(a.lastCheckedTs).toBe(batch[1].ts);
  });
  it('closed state is terminal', () => {
    const a = advance(mk(), [c(0, 100, 101, 97, 99)], 'intraday', T0 + 15 * MIN);
    expect(a.status).toBe('closed');
    const b = advance(a, [c(1, 100, 110, 100, 110)], 'intraday', T0 + 30 * MIN);
    expect(b).toEqual(a);
  });
});

describe('advance short', () => {
  const sc = () => longCand({ direction: 'short', entryLow: 99, entryHigh: 101, stop: 102, tp1: 97, tp2: 94 });
  it('entry then stop = -1R', () => {
    const s = advance(mk(sc()), [c(0, 99, 100, 98, 99), c(1, 99, 102.5, 99, 102)], 'intraday', T0 + 60 * MIN);
    expect(s.fillPrice).toBe(100);
    expect(s.closeReason).toBe('stop');
    expect(s.resultR).toBe(-1);
  });
  it('TP1, TP2 mirrored = +2.25 (risk 2)', () => {
    const cand = longCand({ direction: 'short', stop: 102, tp1: 97, tp2: 94 });
    const s = advance(mk(cand), [c(0, 99, 100, 98, 99), c(1, 99, 99, 96.5, 97), c(2, 97, 97, 93.5, 94)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('tp2');
    expect(s.resultR).toBeCloseTo(2.25, 10);
  });

  it('short: TP1 candle touching fill -> breakeven +0.75', () => {
    const s = advance(mk(sc()), [c(0, 99, 100, 98, 99), c(1, 99, 100.5, 96.5, 98)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('breakeven');
    expect(s.resultR).toBeCloseTo(0.75, 10);
  });
  it('short: TP1+TP2 in one candle not touching fill -> tp2', () => {
    const s = advance(mk(sc()), [c(0, 99, 100, 98, 99), c(1, 99, 99.5, 93.5, 94)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('tp2');
    expect(s.resultR).toBeCloseTo(2.25, 10);
  });
  it('short: edge-only fill at entryLow (99), risk 3', () => {
    const s = advance(mk(sc()), [c(0, 99, 99.5, 98, 99)], 'intraday', T0 + 15 * MIN);
    expect(s.status).toBe('open');
    expect(s.fillPrice).toBe(99);
    const s2 = advance(s, [c(1, 99, 102.5, 99, 102)], 'intraday', T0 + 30 * MIN);
    expect(s2.resultR).toBe(-1);
  });
});

describe('advance fill edge cases (long)', () => {
  it('TP1 candle touching fill -> breakeven +0.75', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 101, 103.5, 99.9, 102)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('breakeven');
    expect(s.resultR).toBeCloseTo(0.75, 10);
  });
  it('TP1+TP2 in one candle not touching fill -> tp2 +2.25', () => {
    const s = advance(mk(), [c(0, 101, 101, 100, 101), c(1, 102, 106.5, 101, 106)], 'intraday', T0 + 60 * MIN);
    expect(s.closeReason).toBe('tp2');
    expect(s.resultR).toBeCloseTo(2.25, 10);
  });
  it('edge-only fill: low 100.5 -> fill 101, risk 3', () => {
    const s = advance(mk(), [c(0, 102, 102, 100.5, 101)], 'intraday', T0 + 15 * MIN);
    expect(s.fillPrice).toBe(101);
    const s2 = advance(s, [c(1, 102, 104.5, 101.5, 104), c(2, 104, 107, 104, 107)], 'intraday', T0 + 60 * MIN);
    // tp1 103: 0.5*2/3 ; tp2 106: 0.5*5/3
    expect(s2.closeReason).toBe('tp2');
    expect(s2.resultR).toBeCloseTo(0.5 * 2 / 3 + 0.5 * 5 / 3, 10);
  });
});
