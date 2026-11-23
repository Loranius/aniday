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

// Зсув Europe/Kyiv відносно UTC (мс) у момент ms
function kyivOffsetMs(ms: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: SIGNALS_CONFIG.tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Початок календарної доби Europe/Kyiv (UTC мс), враховує літній/зимовий час
export function kyivDayStartMs(ms: number): number {
  const [y, m, d] = kyivDay(ms).split('-').map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  const off1 = kyivOffsetMs(midnightAsUtc);
  const t = midnightAsUtc - off1;
  const off2 = kyivOffsetMs(t);
  return off2 === off1 ? t : midnightAsUtc - off2;
}
