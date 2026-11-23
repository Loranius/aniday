import { SIGNALS_CONFIG } from './config';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function callCostUsd(model: string, usage: Usage): number {
  const p = SIGNALS_CONFIG.pricing[model];
  if (!p) return 0;
  const { readMult, writeMult } = SIGNALS_CONFIG.cache;
  const inputEq =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) * readMult +
    (usage.cache_creation_input_tokens ?? 0) * writeMult;
  return (inputEq * p.input + (usage.output_tokens ?? 0) * p.output) / 1_000_000;
}

// Календарна доба за Europe/Kyiv, YYYY-MM-DD
export function kyivDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SIGNALS_CONFIG.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

// Дозволяє виклик, лише якщо після нього (з запасом) обидва ліміти не перевищені
export function canSpend(spentToday: number, spentMonth: number): boolean {
  const { dailyUsd, monthlyUsd, reserveUsd } = SIGNALS_CONFIG.budget;
  return spentToday + reserveUsd <= dailyUsd && spentMonth + reserveUsd <= monthlyUsd;
}
