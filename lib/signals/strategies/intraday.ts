import { SIGNALS_CONFIG } from '../config';
import { atr, ema, highest, lowest, macd, rsi } from '../indicators';
import type { Candidate, Candle, Direction } from '../types';
import { lastOf, prevAvgVolume } from './common';

const T = SIGNALS_CONFIG.strategies.intraday;
const TP = SIGNALS_CONFIG.modes.intraday.tpR;

export function detectIntraday(symbol: string, c15: Candle[], c1h: Candle[]): Candidate | null {
  if (c1h.length < T.minCandles1h || c15.length < T.minCandles15m) return null;

  // Тренд 1h
  const closes1h = c1h.map((c) => c.close);
  const slow = lastOf(ema(closes1h, T.emaTrendSlow));
  const fast = lastOf(ema(closes1h, T.emaTrendFast));
  const close1h = lastOf(closes1h);
  let direction: Direction;
  if (close1h > slow && fast > slow) direction = 'long';
  else if (close1h < slow && fast < slow) direction = 'short';
  else return null;
  const long = direction === 'long';

  const closes = c15.map((c) => c.close);
  const n = c15.length;
  const last = c15[n - 1];
  const a = atr(c15, T.atrPeriod)[n - 1];
  const ema15 = ema(closes, T.emaPullback)[n - 1];
  if (![slow, fast, a, ema15].every(Number.isFinite) || a <= 0) return null;

  // Тригери 15m
  let pattern: string | null = null;
  if (long) {
    if (last.low <= ema15 + T.pullbackAtrMult * a && last.close > ema15 && last.close > last.open) pattern = 'pullback';
  } else if (last.high >= ema15 - T.pullbackAtrMult * a && last.close < ema15 && last.close < last.open) {
    pattern = 'pullback';
  }
  const volMa = prevAvgVolume(c15, T.volMaLen);
  const volMult = last.volume / volMa;
  if (!pattern && volMa > 0 && volMult >= T.breakoutVolMult) {
    const hh = highest(c15.map((c) => c.high), T.breakoutLookback)[n - 1];
    const ll = lowest(c15.map((c) => c.low), T.breakoutLookback)[n - 1];
    if (long ? last.close > hh : last.close < ll) pattern = 'breakout';
  }
  if (!pattern) return null;

  // Фільтр: RSI і гістограма MACD
  const rsiV = rsi(closes, T.rsiPeriod)[n - 1];
  const { hist } = macd(closes);
  const h = hist[n - 1];
  const hPrev = hist[n - 2];
  if (![rsiV, h, hPrev].every(Number.isFinite)) return null;
  if (long ? !(rsiV < T.rsiMaxLong && h > hPrev) : !(rsiV > T.rsiMinShort && h < hPrev)) return null;

  // Вхід / стоп / тейки (стоп по свінгу враховує і поточну свічку)
  const w = T.entryAtrMult * a;
  const entryLow = long ? last.close - w : last.close;
  const entryHigh = long ? last.close : last.close + w;
  const entry = (entryLow + entryHigh) / 2;
  const buf = T.stopSwingAtrBuffer * a;
  let stop: number;
  if (long) {
    const swing = Math.min(lowest(c15.map((c) => c.low), T.stopSwingLookback)[n - 1], last.low);
    stop = Math.min(swing - buf, entry - T.stopMinAtrMult * a);
  } else {
    const swing = Math.max(highest(c15.map((c) => c.high), T.stopSwingLookback)[n - 1], last.high);
    stop = Math.max(swing + buf, entry + T.stopMinAtrMult * a);
  }
  const r = Math.abs(entry - stop);
  if (r > T.stopMaxAtrMult * a || r <= 0) return null;
  const sgn = long ? 1 : -1;

  return {
    mode: 'intraday',
    symbol,
    direction,
    timeframe: '15m',
    candleTs: last.ts,
    entryLow,
    entryHigh,
    stop,
    tp1: entry + sgn * TP[0] * r,
    tp2: entry + sgn * TP[1] * r,
    pattern,
    metrics: { atr: a, rsi: rsiV, macdHist: h, ema50_15m: ema15, ema200_1h: slow, volMult },
  };
}
