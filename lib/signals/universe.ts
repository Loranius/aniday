import type { Ticker } from './types';
import { SIGNALS_CONFIG } from './config';

export interface Snapshot {
  ts: number;
  bySymbol: Record<string, { quoteVolume24h: number; openInterest: number }>;
}
export interface PumpPre {
  symbol: string;
  volBurstPct: number;
  oiChangePct: number;
}

const MIN_MS = 60_000;
const TOLERANCE_MS = 5 * MIN_MS;
const VOL_BURST_MIN_PCT = 3;
const OI_CHANGE_MIN_PCT = 5;

export function topByVolume(tickers: Ticker[], n: number): string[] {
  return [...tickers]
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, n)
    .map((t) => t.symbol);
}

export function makeSnapshot(tickers: Ticker[], now: number): Snapshot {
  const bySymbol: Snapshot['bySymbol'] = {};
  for (const t of tickers) bySymbol[t.symbol] = { quoteVolume24h: t.quoteVolume24h, openInterest: t.openInterest };
  return { ts: now, bySymbol };
}

function nearest(snapshots: Snapshot[], target: number): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    const d = Math.abs(s.ts - target);
    if (d <= TOLERANCE_MS && (!best || d < Math.abs(best.ts - target))) best = s;
  }
  return best;
}

export function pumpPrefilter(tickers: Ticker[], top: Set<string>, snapshots: Snapshot[], now: number): PumpPre[] {
  const s15 = nearest(snapshots, now - 15 * MIN_MS);
  const s30 = nearest(snapshots, now - 30 * MIN_MS);
  if (!s15 || !s30) return [];
  const { pumpMinQuoteVolume24h, pumpMaxCandidates } = SIGNALS_CONFIG.universe;
  const out: PumpPre[] = [];
  for (const t of tickers) {
    if (top.has(t.symbol) || t.quoteVolume24h < pumpMinQuoteVolume24h) continue;
    const v15 = s15.bySymbol[t.symbol];
    const o30 = s30.bySymbol[t.symbol];
    if (!v15 || !o30) continue;
    const volBurstPct = ((t.quoteVolume24h - v15.quoteVolume24h) / t.quoteVolume24h) * 100;
    const oiChangePct = o30.openInterest > 0 ? ((t.openInterest - o30.openInterest) / o30.openInterest) * 100 : 0;
    if (volBurstPct >= VOL_BURST_MIN_PCT || oiChangePct >= OI_CHANGE_MIN_PCT) {
      out.push({ symbol: t.symbol, volBurstPct, oiChangePct });
    }
  }
  return out.sort((a, b) => b.volBurstPct - a.volBurstPct).slice(0, pumpMaxCandidates);
}

export function hotMovers(tickers: Ticker[], top: Set<string>, n = 10): string[] {
  return tickers
    .filter((t) => !top.has(t.symbol) && t.quoteVolume24h >= SIGNALS_CONFIG.universe.pumpMinQuoteVolume24h)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, n)
    .map((t) => t.symbol);
}
