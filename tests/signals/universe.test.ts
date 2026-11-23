import { describe, it, expect } from 'vitest';
import { topByVolume, pumpPrefilter, makeSnapshot, hotMovers } from '../../lib/signals/universe';
import type { Ticker } from '../../lib/signals/types';
import tickersFx from './fixtures/tickers.json';

const tk = (symbol: string, quoteVolume24h: number, change24h = 0, openInterest = 1000): Ticker => ({
  symbol, last: 1, quoteVolume24h, change24h, fundingRate: 0, openInterest,
});
const fixtureTickers: Ticker[] = tickersFx.data.map((d) =>
  tk(d.symbol, Number(d.usdtVolume), Number(d.change24h), Number(d.holdingAmount) * Number(d.lastPr)),
);

describe('topByVolume', () => {
  it('returns top N symbols by volume desc', () => {
    const top = topByVolume(fixtureTickers, 20);
    expect(top).toHaveLength(20);
    expect(top[0]).toBe('BTCUSDT');
    const vols = top.map((s) => fixtureTickers.find((t) => t.symbol === s)!.quoteVolume24h);
    expect([...vols].sort((a, b) => b - a)).toEqual(vols);
  });
});

describe('pumpPrefilter', () => {
  const now = 1_700_000_000_000;
  const MIN = 60_000;
  const top = new Set(['BTCUSDT']);
  const snap = (ts: number, v: Record<string, [number, number]>) => ({
    ts,
    bySymbol: Object.fromEntries(Object.entries(v).map(([k, [q, o]]) => [k, { quoteVolume24h: q, openInterest: o }])),
  });
  const tickers = [tk('BTCUSDT', 2e9), tk('PUMPUSDT', 10_000_000, 0.3, 1000), tk('SMALLUSDT', 1_000_000, 0.5)];

  it('finds candidate, rejects top and low volume', () => {
    const snaps = [
      snap(now - 15 * MIN, { PUMPUSDT: [9_600_000, 1000], BTCUSDT: [1e9, 1], SMALLUSDT: [100_000, 1] }),
      snap(now - 30 * MIN, { PUMPUSDT: [9_000_000, 1000], BTCUSDT: [1e9, 1], SMALLUSDT: [100_000, 1] }),
    ];
    const r = pumpPrefilter(tickers, top, snaps, now);
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe('PUMPUSDT');
    expect(r[0].volBurstPct).toBeCloseTo(4);
    expect(r[0].oiChangePct).toBeCloseTo(0);
  });

  it('candidate via oiChangePct alone', () => {
    const t = [tk('AUSDT', 10_000_000, 0, 1060)];
    const snaps = [
      snap(now - 15 * MIN, { AUSDT: [10_000_000, 1060] }),
      snap(now - 30 * MIN, { AUSDT: [10_000_000, 1000] }),
    ];
    const r = pumpPrefilter(t, new Set(), snaps, now);
    expect(r[0].oiChangePct).toBeCloseTo(6);
  });

  it('returns [] without snapshots or outside tolerance', () => {
    expect(pumpPrefilter(tickers, top, [], now)).toEqual([]);
    expect(pumpPrefilter(tickers, top, [snap(now - 60 * MIN, { PUMPUSDT: [1, 1] })], now)).toEqual([]);
  });

  it('sorts by volBurstPct desc and truncates to pumpMaxCandidates', () => {
    const syms = Array.from({ length: 20 }, (_, i) => `C${i}USDT`);
    const t = syms.map((s) => tk(s, 10_000_000));
    const then15 = Object.fromEntries(syms.map((s, i) => [s, [10_000_000 * (1 - (i + 3) / 100), 1000] as [number, number]]));
    const then30 = Object.fromEntries(syms.map((s) => [s, [10_000_000, 1000] as [number, number]]));
    const r = pumpPrefilter(t, new Set(), [snap(now - 15 * MIN, then15), snap(now - 30 * MIN, then30)], now);
    expect(r).toHaveLength(15);
    expect(r[0].symbol).toBe('C19USDT');
    for (let i = 1; i < r.length; i++) expect(r[i].volBurstPct).toBeLessThanOrEqual(r[i - 1].volBurstPct);
  });
});

describe('makeSnapshot', () => {
  it('maps tickers by symbol', () => {
    const s = makeSnapshot([tk('AUSDT', 5, 0, 7)], 42);
    expect(s).toEqual({ ts: 42, bySymbol: { AUSDT: { quoteVolume24h: 5, openInterest: 7 } } });
  });
});

describe('hotMovers', () => {
  it('returns biggest |change24h| outside top with enough volume', () => {
    const top = new Set(topByVolume(fixtureTickers, 20));
    const r = hotMovers(fixtureTickers, top, 10);
    expect(r[0]).toBe('PUMPUSDT');
    expect(r).not.toContain('SMALLUSDT');
    expect(r.every((s) => !top.has(s))).toBe(true);
    expect(r).toContain('MIDUSDT');
  });
});
