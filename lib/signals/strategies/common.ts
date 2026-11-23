import type { Candle } from '../types';

// Середній об'єм попередніх len свічок (без останньої): сплеск не завищує власну базу
export function prevAvgVolume(candles: Candle[], len: number): number {
  const slice = candles.slice(-len - 1, -1);
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

export const lastOf = <T>(a: T[]): T => a[a.length - 1];
