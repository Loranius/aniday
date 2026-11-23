import { SIGNALS_CONFIG } from '../config';
import { atr, bollingerWidth } from '../indicators';
import type { Candidate, Candle, Ticker } from '../types';
import type { PumpPre } from '../universe';
import { lastOf, prevAvgVolume } from './common';

const T = SIGNALS_CONFIG.strategies.pump;
const TP = SIGNALS_CONFIG.modes.pump.tpR;

export function detectPump(symbol: string, c15: Candle[], ticker: Ticker, pre: PumpPre): Candidate | null {
  if (c15.length < T.minCandles15m) return null;
  const n = c15.length;
  const last = lastOf(c15);

  // Обов'язково: сплеск об'єму
  const volMa = prevAvgVolume(c15, T.volMaLen);
  const volMult = last.volume / volMa;
  if (!(volMa > 0) || volMult < T.volMult) return null;

  // Напрям за кольором свічки-сплеску
  if (last.close === last.open) return null;
  const long = last.close > last.open;

  // Funding-фільтр
  if (long ? ticker.fundingRate > T.fundingMax : ticker.fundingRate < -T.fundingMax) return null;

  // Стиснення: мінімум ширини BB за squeezeLookback свічок перед останньою <= перцентиль ширини за squeezeWindow
  const widths = bollingerWidth(c15.map((c) => c.close), T.bbPeriod, T.bbK);
  const window = widths.slice(n - T.squeezeWindow).filter(Number.isFinite);
  const before = widths.slice(n - 1 - T.squeezeLookback, n - 1);
  if (before.some((w) => !Number.isFinite(w)) || window.length < T.squeezeWindow) return null;
  const minBefore = Math.min(...before);
  const sorted = [...window].sort((x, y) => x - y);
  const p = sorted[Math.floor((T.squeezePercentile / 100) * (sorted.length - 1))];
  const squeeze = minBefore <= p;
  const bbWidthPct = (window.filter((w) => w <= minBefore).length / window.length) * 100;

  if (!squeeze && !(pre.oiChangePct >= T.oiMinPct)) return null;

  const a = atr(c15, T.atrPeriod)[n - 1];
  if (!Number.isFinite(a) || a <= 0) return null;

  const w = T.entryAtrMult * a;
  const entryLow = long ? last.close - w : last.close;
  const entryHigh = long ? last.close : last.close + w;
  const entry = (entryLow + entryHigh) / 2;
  const stop = long ? last.low - T.stopAtrBuffer * a : last.high + T.stopAtrBuffer * a;
  const r = Math.abs(entry - stop);
  if (long ? stop >= entryLow : stop <= entryHigh) return null;
  if (r > T.stopMaxAtrMult * a) return null;
  const sgn = long ? 1 : -1;

  return {
    mode: 'pump',
    symbol,
    direction: long ? 'long' : 'short',
    timeframe: '15m',
    candleTs: last.ts,
    entryLow,
    entryHigh,
    stop,
    tp1: entry + sgn * TP[0] * r,
    tp2: entry + sgn * TP[1] * r,
    pattern: squeeze ? 'volume_spike_squeeze' : 'volume_spike_oi',
    metrics: { volMult, oiChangePct: pre.oiChangePct, fundingRate: ticker.fundingRate, bbWidthPct, atr: a },
  };
}
