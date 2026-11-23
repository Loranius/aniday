import type { Candidate, Mode, SignalGroup } from './types';
import type { Sizing } from './sizing';
import type { SignalRow } from './repo';
import type { StatsReport, Bucket } from './stats';
import { SIGNALS_CONFIG } from './config';

export interface Notifier {
  // повертає message_id; помилки логуються, не кидаються
  send(text: string, replyTo?: number): Promise<number | null>;
}

export function createTelegram(token: string, chatId: string, fetchImpl: typeof fetch = fetch): Notifier {
  return {
    async send(text, replyTo) {
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`Telegram sendMessage: HTTP ${res.status} ${body}`);
          return null;
        }
        const j = (await res.json()) as { result?: { message_id?: number } };
        return j.result?.message_id ?? null;
      } catch (e) {
        console.error('Telegram sendMessage: помилка мережі', e);
        return null;
      }
    },
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// DD.MM HH:mm за Europe/Kyiv (з урахуванням літнього часу)
export function formatKyiv(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SIGNALS_CONFIG.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('day')}.${g('month')} ${g('hour')}:${g('minute')}`;
}

const MODE_LABEL: Record<Mode, string> = {
  scalp: 'скальп',
  intraday: 'інтрадей',
  pump: '🚀 висока волатильність',
};

const num = (x: number, d: number) => x.toFixed(d);
// 1 → "1", 0.75 → "0.75", 1.5 → "1.5"
const trimNum = (x: number) => String(Number(x.toFixed(2)));
const signedR = (r: number) => (r < 0 ? `−${trimNum(-r)}R` : `+${trimNum(r)}R`);

// Група 'shadow' ніколи не форматується й не надсилається — для неї кидаємо помилку.
// riskPct (необов'язковий) — відсоток ризику від депозиту для рядка «Ризик».
export function formatSignal(
  c: Candidate,
  sizing: Sizing,
  group: SignalGroup,
  claudeReason: string | null,
  entryDeadline: number,
  pricePlace: number,
  riskPct?: number,
): string {
  if (group === 'shadow') throw new Error('formatSignal: shadow-сигнали не надсилаються');
  const p = (x: number) => num(x, pricePlace);
  const entryMid = (c.entryLow + c.entryHigh) / 2;
  const risk = Math.abs(entryMid - c.stop);
  const rOf = (tp: number) => (risk > 0 ? Math.abs(tp - entryMid) / risk : 0);
  const stopPct = (Math.abs(entryMid - c.stop) / entryMid) * 100;
  const long = c.direction === 'long';
  const liqOk = long ? sizing.liquidationPrice < c.stop : sizing.liquidationPrice > c.stop;

  const lines: string[] = [];
  lines.push(`${long ? '🟢 LONG' : '🔴 SHORT'} ${escapeHtml(c.symbol)} · ${MODE_LABEL[c.mode]} ${escapeHtml(c.timeframe)}`);
  lines.push(`Вхід: ${p(c.entryLow)}–${p(c.entryHigh)}`);
  lines.push(`Стоп: ${p(c.stop)} (−${stopPct.toFixed(1)}%)`);
  let tp = `TP1: ${p(c.tp1)} (${trimNum(rOf(c.tp1))}R)`;
  if (c.tp2 !== null) tp += ` · TP2: ${p(c.tp2)} (${trimNum(rOf(c.tp2))}R)`;
  lines.push(tp);
  lines.push(
    `Позиція: ${sizing.qty} ${c.symbol.replace(/USDT$/, '')} ≈ $${Math.round(sizing.notionalUsd)} · плече ${sizing.leverage}x · маржа $${Math.round(sizing.marginUsd)}`,
  );
  const riskPctStr = riskPct === undefined ? '' : ` (${trimNum(riskPct)}%)`;
  lines.push(`Ризик: $${trimNum(sizing.riskUsd)}${riskPctStr} · ліквідація ≈ ${p(sizing.liquidationPrice)} ${liqOk ? '✅' : '⚠️'}`);
  lines.push(
    group === 'no_claude' || claudeReason === null
      ? '⚠️ без перевірки Claude'
      : `Claude: ${escapeHtml(claudeReason)}`,
  );
  for (const w of sizing.warnings) lines.push(`⚠️ ${escapeHtml(w)}`);
  lines.push(`Вхід дійсний до: ${formatKyiv(entryDeadline)}`);
  return lines.join('\n');
}

export function formatClose(row: SignalRow): string {
  const head = (e: string) => `${e} ${escapeHtml(row.symbol)} ${row.direction === 'long' ? 'LONG' : 'SHORT'}:`;
  if (row.status === 'not_filled') return `⌛ ${escapeHtml(row.symbol)} ${row.direction === 'long' ? 'LONG' : 'SHORT'}: не спрацював`;
  const r = row.resultR ?? 0;
  switch (row.closeReason) {
    case 'tp2': return `${head('✅')} TP2 ${signedR(r)}`;
    case 'tp': return `${head('✅')} TP ${signedR(r)}`;
    case 'stop': return `${head('❌')} стоп ${signedR(r)}`;
    case 'breakeven': return `${head('➖')} беззбиток ${signedR(r)}`;
    case 'timeout': return `${head('➖')} таймаут ${signedR(r)}`;
    default: return `${head('➖')} закрито ${signedR(r)}`;
  }
}

function bucketLine(label: string, b: Bucket): string {
  if (b.total === 0) return `${label}: —`;
  return `${label}: ${b.total} шт · не спрацювали ${b.notFilled} · win ${b.winRate === null ? '—' : `${(b.winRate * 100).toFixed(0)}%`} · сер. ${b.avgR === null ? '—' : signedR(b.avgR)} · Σ ${signedR(b.sumR)}`;
}

const GROUP_LABEL: Record<SignalGroup, string> = {
  confirmed: 'підтверджені Claude (confirmed)',
  shadow: 'відхилені Claude, тінь (shadow)',
  no_claude: 'без Claude (no_claude)',
};

export function formatStats(r: StatsReport, spendMonthUsd: number): string {
  const lines: string[] = ['📊 <b>Статистика</b>'];
  for (const mode of ['scalp', 'intraday', 'pump'] as Mode[]) {
    lines.push('', `<b>${mode}</b>`);
    for (const b of r.buckets.filter((x) => x.mode === mode)) lines.push(bucketLine(`  ${b.group}`, b));
  }
  lines.push('', '<b>Порівняння груп</b>');
  for (const g of ['confirmed', 'shadow', 'no_claude'] as SignalGroup[]) lines.push(bucketLine(`  ${GROUP_LABEL[g]}`, r.byGroup[g]));
  lines.push('', `Витрати Claude за місяць: $${spendMonthUsd.toFixed(2)} з $${SIGNALS_CONFIG.budget.monthlyUsd}`);
  return lines.join('\n');
}
