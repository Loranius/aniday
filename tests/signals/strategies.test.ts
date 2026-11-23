import { describe, expect, it } from 'vitest';
import type { Candidate, Candle, Ticker } from '../../lib/signals/types';
import { detectIntraday } from '../../lib/signals/strategies/intraday';
import { detectPump } from '../../lib/signals/strategies/pump';
import { detectScalp } from '../../lib/signals/strategies/scalp';

const STEP = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };

// Свічки з масиву close: open = попередній close, wick — тінь з обох боків
function makeCandles(closes: number[], opts: { wick?: number; vol?: number; step?: number } = {}): Candle[] {
  const { wick = 0.2, vol = 100, step = STEP['15m'] } = opts;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      ts: 1_700_000_000_000 + i * step,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: vol,
      quoteVolume: vol * close,
    };
  });
}

// Підміна останньої свічки
function withLast(c: Candle[], patch: Partial<Candle>): Candle[] {
  const last = { ...c[c.length - 1], ...patch };
  return [...c.slice(0, -1), last];
}

// Дзеркало цін навколо 200: long-сценарій -> short-сценарій
function mirror(c: Candle[]): Candle[] {
  return c.map((x) => ({
    ...x,
    open: 200 - x.open,
    close: 200 - x.close,
    high: 200 - x.low,
    low: 200 - x.high,
  }));
}

const noise = (n: number, base = 100, amp = 0.3) =>
  Array.from({ length: n }, (_, i) => base + amp * Math.sin(i * 0.9));

const trendUp1h = () => makeCandles(Array.from({ length: 250 }, (_, i) => 100 + i * 0.5), { step: STEP['1h'] });

function expectLong(c: Candidate | null, k: number, hasTp2: boolean) {
  expect(c).not.toBeNull();
  const x = c!;
  expect(x.direction).toBe('long');
  expect(x.entryLow).toBeLessThan(x.entryHigh);
  expect(x.stop).toBeLessThan(x.entryLow);
  const entry = (x.entryLow + x.entryHigh) / 2;
  const r = entry - x.stop;
  expect(x.tp1 - entry).toBeCloseTo(k * r, 6);
  if (hasTp2) expect(x.tp2! - entry).toBeCloseTo(3 * r, 6);
  else expect(x.tp2).toBeNull();
}

function expectShort(c: Candidate | null, k: number, hasTp2: boolean) {
  expect(c).not.toBeNull();
  const x = c!;
  expect(x.direction).toBe('short');
  expect(x.entryLow).toBeLessThan(x.entryHigh);
  expect(x.stop).toBeGreaterThan(x.entryHigh);
  const entry = (x.entryLow + x.entryHigh) / 2;
  const r = x.stop - entry;
  expect(entry - x.tp1).toBeCloseTo(k * r, 6);
  if (hasTp2) expect(entry - x.tp2!).toBeCloseTo(3 * r, 6);
  else expect(x.tp2).toBeNull();
}

describe('detectIntraday', () => {
  const c1h = trendUp1h();
  const base15 = () => makeCandles(noise(80));
  const breakout15 = () => withLast(base15(), { open: 100.7, close: 101, high: 101.05, low: 100.65, volume: 400 });
  const pullback15 = () => withLast(base15(), { open: 99.9, close: 100.3, high: 100.35, low: 99.8, volume: 100 });

  it('long: пробій у висхідному тренді', () => {
    const c15 = breakout15();
    const r = detectIntraday('BTCUSDT', c15, c1h);
    expectLong(r, 1.5, true);
    expect(r!.mode).toBe('intraday');
    expect(r!.timeframe).toBe('15m');
    expect(r!.candleTs).toBe(c15[c15.length - 1].ts);
    expect(r!.pattern).toBe('breakout');
  });

  it('long: відкат до EMA50', () => {
    const r = detectIntraday('BTCUSDT', pullback15(), c1h);
    expectLong(r, 1.5, true);
    expect(r!.pattern).toBe('pullback');
  });

  it('short: дзеркальний пробій у низхідному тренді', () => {
    const r = detectIntraday('BTCUSDT', mirror(breakout15()), mirror(c1h));
    expectShort(r, 1.5, true);
    expect(r!.pattern).toBe('breakout');
  });

  it('short: дзеркальний відкат', () => {
    const r = detectIntraday('BTCUSDT', mirror(pullback15()), mirror(c1h));
    expectShort(r, 1.5, true);
    expect(r!.pattern).toBe('pullback');
  });

  it('пласкі свічки -> null', () => {
    const flat = makeCandles(new Array(80).fill(100));
    expect(detectIntraday('BTCUSDT', flat, c1h)).toBeNull();
  });

  it('контртрендовий тригер (long-пробій у низхідному тренді) -> null', () => {
    expect(detectIntraday('BTCUSDT', breakout15(), mirror(c1h))).toBeNull();
  });

  it('немає тренду на 1h -> null', () => {
    const flat1h = makeCandles(new Array(250).fill(100), { step: STEP['1h'] });
    expect(detectIntraday('BTCUSDT', breakout15(), flat1h)).toBeNull();
  });

  it('недостатньо свічок 1h -> null', () => {
    expect(detectIntraday('BTCUSDT', breakout15(), c1h.slice(-209))).toBeNull();
  });

  it('недостатньо свічок 15m -> null', () => {
    expect(detectIntraday('BTCUSDT', breakout15().slice(-30), c1h)).toBeNull();
  });
});

describe('detectPump', () => {
  const ticker = (fundingRate = 0): Ticker => ({
    symbol: 'XUSDT',
    last: 101.5,
    quoteVolume24h: 10_000_000,
    change24h: 1,
    fundingRate,
    openInterest: 1,
  });
  const pre = (oiChangePct = 0) => ({ symbol: 'XUSDT', volBurstPct: 5, oiChangePct });
  const spike = { open: 100, close: 101.5, high: 101.7, low: 99.8, volume: 800 };

  // 100 свічок шуму + 40 ідеально плоских closes (стиснення), широкі тіні, щоб ATR був співмірний зі спайком
  const squeezed = () => makeCandles([...noise(100, 100, 1), ...new Array(39).fill(100), 100], { wick: 0.5 });
  // Шум із зростаючою амплітудою — останні ширини BB найбільші, стиснення немає
  const loud = () =>
    makeCandles(
      Array.from({ length: 140 }, (_, i) => 100 + (0.5 + i * 0.02) * Math.sin(i * 0.9)),
      { wick: 0.5 },
    );

  it('long: сплеск об’єму + стиснення', () => {
    const c15 = withLast(squeezed(), spike);
    const r = detectPump('XUSDT', c15, ticker(), pre(0));
    expectLong(r, 1.5, true);
    expect(r!.mode).toBe('pump');
    expect(r!.timeframe).toBe('15m');
    expect(r!.candleTs).toBe(c15[c15.length - 1].ts);
    expect(r!.metrics).toMatchObject({ fundingRate: 0, oiChangePct: 0 });
    expect(r!.metrics.volMult).toBeGreaterThanOrEqual(5);
    expect(r!.metrics).toHaveProperty('bbWidthPct');
  });

  it('long: сплеск + OI ≥ 5% без стиснення', () => {
    const r = detectPump('XUSDT', withLast(loud(), spike), ticker(), pre(6));
    expectLong(r, 1.5, true);
  });

  it('сплеск без стиснення і без OI -> null', () => {
    expect(detectPump('XUSDT', withLast(loud(), spike), ticker(), pre(1))).toBeNull();
  });

  it('стиснення без сплеску об’єму -> null', () => {
    const c15 = withLast(squeezed(), { ...spike, volume: 300 });
    expect(detectPump('XUSDT', c15, ticker(), pre(10))).toBeNull();
  });

  it('short: дзеркальний сплеск вниз', () => {
    const c15 = mirror(withLast(squeezed(), spike));
    expectShort(detectPump('XUSDT', c15, ticker(0), pre(0)), 1.5, true);
  });

  it('long відхилено при funding > 0.0005', () => {
    const c15 = withLast(squeezed(), spike);
    expect(detectPump('XUSDT', c15, ticker(0.001), pre(0))).toBeNull();
  });

  it('short відхилено при funding < -0.0005, але дозволено при високому позитивному', () => {
    const c15 = mirror(withLast(squeezed(), spike));
    expect(detectPump('XUSDT', c15, ticker(-0.001), pre(0))).toBeNull();
    expectShort(detectPump('XUSDT', c15, ticker(0.001), pre(0)), 1.5, true);
  });

  it('пласкі свічки -> null', () => {
    const flat = makeCandles(new Array(140).fill(100));
    expect(detectPump('XUSDT', flat, ticker(), pre(10))).toBeNull();
  });

  it('стоп далі 4·ATR -> null', () => {
    const c15 = withLast(squeezed(), { ...spike, low: 90 });
    expect(detectPump('XUSDT', c15, ticker(), pre(0))).toBeNull();
  });

  it('недостатньо свічок -> null', () => {
    expect(detectPump('XUSDT', withLast(squeezed(), spike).slice(-50), ticker(), pre(10))).toBeNull();
  });
});

describe('detectScalp', () => {
  const flat1 = () => makeCandles(new Array(70).fill(100), { step: STEP['1m'], wick: 0.05 });
  const base5 = () => makeCandles(noise(80), { step: STEP['5m'], wick: 0.3 });
  const breakout5 = () => withLast(base5(), { open: 100, close: 101.5, high: 101.55, low: 99.9, volume: 500 });
  const bounce5 = () => withLast(base5(), { open: 100, close: 100.1, high: 100.2, low: 98.5, volume: 100 });

  it('long: пробій 5m', () => {
    const c5 = breakout5();
    const r = detectScalp('ETHUSDT', c5, flat1());
    expectLong(r, 1.2, false);
    expect(r!.mode).toBe('scalp');
    expect(r!.timeframe).toBe('5m');
    expect(r!.candleTs).toBe(c5[c5.length - 1].ts);
    expect(r!.pattern).toBe('breakout');
  });

  it('long: відскок від рівня', () => {
    const r = detectScalp('ETHUSDT', bounce5(), flat1());
    expectLong(r, 1.2, false);
    expect(r!.pattern).toBe('level_bounce');
  });

  it('long: перетин VWAP на 1m', () => {
    const c1 = makeCandles([...new Array(40).fill(100), ...new Array(28).fill(99), 99, 100.2], {
      step: STEP['1m'],
      wick: 0.05,
    });
    const c5 = makeCandles(new Array(80).fill(100), { step: STEP['5m'], wick: 0.2 });
    const r = detectScalp('ETHUSDT', c5, c1);
    expectLong(r, 1.2, false);
    expect(r!.pattern).toBe('vwap_cross');
  });

  it('short: дзеркальний пробій', () => {
    const r = detectScalp('ETHUSDT', mirror(breakout5()), mirror(flat1()));
    expectShort(r, 1.2, false);
    expect(r!.pattern).toBe('breakout');
  });

  it('short: дзеркальний відскок від рівня', () => {
    expectShort(detectScalp('ETHUSDT', mirror(bounce5()), mirror(flat1())), 1.2, false);
  });

  it('short: дзеркальний VWAP', () => {
    const c1 = makeCandles([...new Array(40).fill(100), ...new Array(28).fill(99), 99, 100.2], {
      step: STEP['1m'],
      wick: 0.05,
    });
    const c5 = makeCandles(new Array(80).fill(100), { step: STEP['5m'], wick: 0.2 });
    expectShort(detectScalp('ETHUSDT', mirror(c5), mirror(c1)), 1.2, false);
  });

  it('пласкі свічки -> null', () => {
    const c5 = makeCandles(new Array(80).fill(100), { step: STEP['5m'] });
    expect(detectScalp('ETHUSDT', c5, flat1())).toBeNull();
  });

  it('недостатньо свічок -> null', () => {
    expect(detectScalp('ETHUSDT', breakout5().slice(-30), flat1())).toBeNull();
    expect(detectScalp('ETHUSDT', breakout5(), flat1().slice(-20))).toBeNull();
  });
});
