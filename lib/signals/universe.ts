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
  const toleranceMs = SIGNALS_CONFIG.universe.snapshotToleranceMin * MIN_MS;
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    const d = Math.abs(s.ts - target);
    if (d <= toleranceMs && (!best || d < Math.abs(best.ts - target))) best = s;
  }
  return best;
}

export function pumpPrefilter(tickers: Ticker[], top: Set<string>, snapshots: Snapshot[], now: number): PumpPre[] {
  const u = SIGNALS_CONFIG.universe;
  const s15 = nearest(snapshots, now - u.pumpVolLookbackMin * MIN_MS);
  const s30 = nearest(snapshots, now - u.pumpOiLookbackMin * MIN_MS);
  if (!s15 || !s30) return [];
  const { pumpMinQuoteVolume24h, pumpMaxCandidates } = u;
  const out: PumpPre[] = [];
  for (const t of tickers) {
    if (top.has(t.symbol) || t.quoteVolume24h < pumpMinQuoteVolume24h) continue;
    const v15 = s15.bySymbol[t.symbol];
    const o30 = s30.bySymbol[t.symbol];
    if (!v15 || !o30) continue;
    const volBurstPct = ((t.quoteVolume24h - v15.quoteVolume24h) / t.quoteVolume24h) * 100;
    const oiChangePct = o30.openInterest > 0 ? ((t.openInterest - o30.openInterest) / o30.openInterest) * 100 : 0;
    if (volBurstPct >= u.pumpVolBurstMinPct || oiChangePct >= u.pumpOiChangeMinPct) {
      out.push({ symbol: t.symbol, volBurstPct, oiChangePct });
    }
  }
  return out.sort((a, b) => b.volBurstPct - a.volBurstPct).slice(0, pumpMaxCandidates);
}

export function hotMovers(tickers: Ticker[], top: Set<string>, n = SIGNALS_CONFIG.universe.hotMoversN): string[] {
  return tickers
    .filter((t) => !top.has(t.symbol) && t.quoteVolume24h >= SIGNALS_CONFIG.universe.pumpMinQuoteVolume24h)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, n)
    .map((t) => t.symbol);
}
