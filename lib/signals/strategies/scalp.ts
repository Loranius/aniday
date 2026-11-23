import { SIGNALS_CONFIG } from '../config';
import { atr, highest, lowest, vwap } from '../indicators';
import type { Candidate, Candle } from '../types';
import { lastOf, prevAvgVolume } from './common';

const T = SIGNALS_CONFIG.strategies.scalp;
const TP = SIGNALS_CONFIG.modes.scalp.tpR;

export function detectScalp(symbol: string, c5: Candle[], c1: Candle[]): Candidate | null {
  if (c5.length < T.minCandles5m || c1.length < T.minCandles1m) return null;
  const n = c5.length;
  const last = lastOf(c5);
  const a = atr(c5, T.atrPeriod)[n - 1];
  if (!Number.isFinite(a) || a <= 0) return null;
  const range = last.high - last.low;
  if (range <= 0) return null;

  const volMa = prevAvgVolume(c5, T.volMaLen);
  const volMult = volMa > 0 ? last.volume / volMa : 0;
  const hh = highest(c5.map((c) => c.high), T.breakoutLookback)[n - 1];
  const ll = lowest(c5.map((c) => c.low), T.breakoutLookback)[n - 1];
  const zone = T.closeZonePct / 100;
  const wick = T.wickMinPct / 100;

  // (а) пробій
  const volOk = volMult >= T.breakoutVolMult;
  const breakoutLong = volOk && last.close > hh && (last.close - last.low) / range >= 1 - zone;
  const breakoutShort = volOk && last.close < ll && (last.high - last.close) / range >= 1 - zone;

  // (б) VWAP по 1m
  const v = vwap(c1.slice(-T.vwapWindow));
  const l1 = c1[c1.length - 1];
  const p1 = c1[c1.length - 2];
  const vL = v[v.length - 1];
  const vP = v[v.length - 2];
  const vwapLong = p1.close < vP && l1.close > vL && l1.close > l1.open;
  const vwapShort = p1.close > vP && l1.close < vL && l1.close < l1.open;

  // (в) відскок від рівня
  const lvlLow = lowest(c5.map((c) => c.low), T.levelLookback)[n - 1];
  const lvlHigh = highest(c5.map((c) => c.high), T.levelLookback)[n - 1];
  const bounceLong =
    last.low <= lvlLow + T.levelAtrMult * a && (Math.min(last.open, last.close) - last.low) / range >= wick;
  const bounceShort =
    last.high >= lvlHigh - T.levelAtrMult * a && (last.high - Math.max(last.open, last.close)) / range >= wick;

  let long: boolean;
  let pattern: string;
  if (breakoutLong) [long, pattern] = [true, 'breakout'];
  else if (vwapLong) [long, pattern] = [true, 'vwap_cross'];
  else if (bounceLong) [long, pattern] = [true, 'level_bounce'];
  else if (breakoutShort) [long, pattern] = [false, 'breakout'];
  else if (vwapShort) [long, pattern] = [false, 'vwap_cross'];
  else if (bounceShort) [long, pattern] = [false, 'level_bounce'];
  else return null;

  const w = T.entryAtrMult * a;
  const entryLow = long ? last.close - w : last.close;
  const entryHigh = long ? last.close : last.close + w;
  const entry = (entryLow + entryHigh) / 2;
  const stop = long ? last.low - T.stopAtrBuffer * a : last.high + T.stopAtrBuffer * a;
  if (long ? stop >= entryLow : stop <= entryHigh) return null;
  const r = Math.abs(entry - stop);
  const sgn = long ? 1 : -1;

  return {
    mode: 'scalp',
    symbol,
    direction: long ? 'long' : 'short',
    timeframe: '5m',
    candleTs: last.ts,
    entryLow,
    entryHigh,
    stop,
    tp1: entry + sgn * TP[0] * r,
    tp2: null,
    pattern,
    metrics: { atr: a, volMult, vwap1m: vL },
  };
}
