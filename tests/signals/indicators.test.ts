import { describe, it, expect } from 'vitest';
import { ema, sma, rsi, macd, atr, bollingerWidth, vwap, highest, lowest } from '../../lib/signals/indicators';
import type { Candle } from '../../lib/signals/types';

const candle = (o: number, h: number, l: number, c: number, v = 1): Candle => ({
  ts: 0, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c,
});

describe('indicators', () => {
  it('sma', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });
  it('ema', () => {
    const r = ema([1, 2, 3, 4, 5], 3);
    expect(r).toEqual([NaN, NaN, 2, 3, 4]);
    expect(r[4]).toBeCloseTo(4);
  });
  it('rsi монотонно зростаючих = 100', () => {
    const closes = Array.from({ length: 15 }, (_, i) => i + 1);
    const r = rsi(closes);
    expect(r).toHaveLength(15);
    expect(r[14]).toBe(100);
  });
  it('atr', () => {
    const cs = Array.from({ length: 15 }, () => candle(10, 11, 9, 10));
    const r = atr(cs);
    expect(r).toHaveLength(15);
    expect(r[14]).toBeCloseTo(2);
  });
  it('bollingerWidth сталих = 0', () => {
    const r = bollingerWidth(Array(25).fill(5));
    expect(r[24]).toBe(0);
    expect(Number.isNaN(r[18])).toBe(true);
  });
  it('vwap', () => {
    // tp = (h+l+c)/3
    const r = vwap([candle(10, 10, 10, 10, 1), candle(20, 20, 20, 20, 3)]);
    expect(r).toEqual([10, 17.5]);
  });
  it('highest/lowest по попередніх', () => {
    expect(highest([1, 5, 3, 2], 2)).toEqual([NaN, NaN, 5, 5]);
    expect(lowest([4, 2, 3, 5], 2)).toEqual([NaN, NaN, 2, 2]);
  });
  it('macd довжина', () => {
    const closes = Array.from({ length: 50 }, (_, i) => i);
    const m = macd(closes, 12, 26, 9);
    expect(m.macd).toHaveLength(50);
    expect(m.signal).toHaveLength(50);
    expect(m.hist).toHaveLength(50);
    expect(m.macd[49]).toBeGreaterThan(0);
  });
});
