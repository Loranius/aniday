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
  budget: { monthlyUsd: 20, dailyUsd: 20 / 30, reserveUsd: 0.02, reserveHaikuUsd: 0.002 },
  // множники ціни кешу промпта відносно ціни вхідних токенів
  cache: { readMult: 0.1, writeMult: 1.25 },
  claude: {
    maxTokens: 2000,
    maxRetries: 1,
    candlesInPrompt: 40,
    reasonMaxChars: 200,
    timeoutMs: { 'claude-haiku-5-5': 20_000, 'claude-sonnet-5-5': 40_000 } as Record<string, number>,
    defaultTimeoutMs: 40_000,
  },
  sizing: { defaultDepositUsd: 500, maxMarginPct: 20, maxLeverage: 20, mmr: 0.005, highRiskWarnPct: 5 },
  universe: {
    topN: 20,
    pumpMinQuoteVolume24h: 5_000_000,
    pumpMaxCandidates: 15,
    pumpVolBurstMinPct: 3,
    pumpOiChangeMinPct: 5,
    pumpVolLookbackMin: 15,
    pumpOiLookbackMin: 30,
    snapshotToleranceMin: 5,
  },
  scalpDailyLimit: 10,
  // межі значень, які власник задає командами Telegram
  commandBounds: { riskMinPct: 0.1, riskMaxPct: 50, depositMinUsd: 0, scalpLimitMin: 0, scalpLimitMax: 100 },
  maxReviewsPerRun: 5,
  tz: 'Europe/Kyiv',
  strategies: {
    intraday: {
      minCandles1h: 210, // EMA200 на 1h + запас
      minCandles15m: 60,
      emaTrendSlow: 200,
      emaTrendFast: 50,
      emaPullback: 50, // EMA на 15m
      atrPeriod: 14,
      pullbackAtrMult: 0.25,
      breakoutLookback: 20,
      volMaLen: 20,
      breakoutVolMult: 1.5,
      rsiPeriod: 14,
      rsiMaxLong: 70,
      rsiMinShort: 30,
      entryAtrMult: 0.25,
      stopSwingLookback: 10,
      stopSwingAtrBuffer: 0.1,
      stopMinAtrMult: 1.0,
      stopMaxAtrMult: 3,
    },
    pump: {
      minCandles15m: 130,
      atrPeriod: 14,
      volMaLen: 20,
      volMult: 5,
      bbPeriod: 20,
      bbK: 2,
      squeezeLookback: 6,
      squeezeWindow: 100,
      squeezePercentile: 20,
      oiMinPct: 5,
      fundingMax: 0.0005,
      entryAtrMult: 0.3,
      stopAtrBuffer: 0.1,
      stopMaxAtrMult: 4,
    },
    scalp: {
      minCandles5m: 60,
      minCandles1m: 62,
      atrPeriod: 14,
      volMaLen: 20,
      breakoutLookback: 12,
      breakoutVolMult: 3,
      closeZonePct: 25,
      vwapWindow: 60,
      levelLookback: 48,
      levelAtrMult: 0.1,
      wickMinPct: 60,
      entryAtrMult: 0.15,
      stopAtrBuffer: 0.1,
    },
  },
};
