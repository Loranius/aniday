import type { Mode } from './types';

// Усі числові пороги бота живуть тільки тут.
export interface ModeConfig {
  entryWindowMin: number;
  timeoutMin: number;
  defaultRiskPct: number;
  model: string;
  tpR: number[];
}

export const SIGNALS_CONFIG = {
  modes: {
    scalp: { entryWindowMin: 15, timeoutMin: 240, defaultRiskPct: 1, model: 'claude-haiku-5-5', tpR: [1.2] },
    intraday: { entryWindowMin: 120, timeoutMin: 4320, defaultRiskPct: 2, model: 'claude-sonnet-5-5', tpR: [1.5, 3] },
    pump: { entryWindowMin: 120, timeoutMin: 4320, defaultRiskPct: 1, model: 'claude-sonnet-5-5', tpR: [1.5, 3] },
  } as Record<Mode, ModeConfig>,
  // USD за 1M токенів
  pricing: {
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  } as Record<string, { input: number; output: number }>,
  budget: { monthlyUsd: 20, dailyUsd: 20 / 30 },
  sizing: { defaultDepositUsd: 500, maxMarginPct: 20, maxLeverage: 20, mmr: 0.005 },
  universe: { topN: 20, pumpMinQuoteVolume24h: 5_000_000, pumpMaxCandidates: 15 },
  scalpDailyLimit: 10,
  maxReviewsPerRun: 5,
  tz: 'Europe/Kyiv',
  // Пороги стратегій заповнюються в Task 3
  strategies: {} as Record<string, Record<string, number>>,
};
