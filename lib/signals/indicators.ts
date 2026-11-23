import type { Candle } from './types';

const nans = (n: number): number[] => new Array<number>(n).fill(NaN);

export function sma(values: number[], period: number): number[] {
  const out = nans(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Seed = SMA перших period значень; значення NaN на початку ігноруються (для signal MACD)
export function ema(values: number[], period: number): number[] {
  const out = nans(values.length);
  const start = values.findIndex((v) => !Number.isNaN(v));
  if (start < 0 || values.length - start < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i];
  let prev = sum / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = nans(closes.length);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const calc = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = calc();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = calc();
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const signal = ema(line, signalPeriod);
  const hist = line.map((v, i) => v - signal[i]);
  return { macd: line, signal, hist };
}

// Wilder ATR
export function atr(candles: Candle[], period = 14): number[] {
  const out = nans(candles.length);
  if (candles.length < period) return out;
  const tr = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  let prev = 0;
  for (let i = 0; i < period; i++) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// (upper - lower) / middle
export function bollingerWidth(closes: number[], period = 20, k = 2): number[] {
  const mid = sma(closes, period);
  const out = nans(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sq / period);
    out[i] = (2 * k * sd) / mid[i];
  }
  return out;
}

// Кумулятивний VWAP від першої свічки, typical price = (h+l+c)/3
export function vwap(candles: Candle[]): number[] {
  let pv = 0;
  let v = 0;
  return candles.map((c) => {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    v += c.volume;
    return v === 0 ? NaN : pv / v;
  });
}

// По попередніх lookback елементах, без поточного
function rolling(values: number[], lookback: number, pick: (a: number, b: number) => number): number[] {
  const out = nans(values.length);
  for (let i = lookback; i < values.length; i++) {
    let r = values[i - lookback];
    for (let j = i - lookback + 1; j < i; j++) r = pick(r, values[j]);
    out[i] = r;
  }
  return out;
}

export const highest = (values: number[], lookback: number): number[] => rolling(values, lookback, Math.max);
export const lowest = (values: number[], lookback: number): number[] => rolling(values, lookback, Math.min);
