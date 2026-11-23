// Спільні типи сигнального бота

export type Mode = 'scalp' | 'intraday' | 'pump';
export type Direction = 'long' | 'short';

// ts — початок свічки, мс; масиви завжди за зростанням ts
export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  quoteVolume24h: number;
  change24h: number;
  fundingRate: number;
  openInterest: number;
}

export interface Candidate {
  mode: Mode;
  symbol: string;
  direction: Direction;
  timeframe: string;
  candleTs: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  tp1: number;
  tp2: number | null;
  pattern: string;
  metrics: Record<string, number>;
}

export type SignalGroup = 'confirmed' | 'shadow' | 'no_claude';
export type SignalStatus = 'pending' | 'open' | 'not_filled' | 'closed';
export type CloseReason = 'tp2' | 'tp' | 'stop' | 'breakeven' | 'timeout';
