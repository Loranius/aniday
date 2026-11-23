import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { callCostUsd } from './budget';
import { SIGNALS_CONFIG } from './config';
import type { Candidate, Candle, Ticker } from './types';

export type Review =
  | { decision: 'confirm' | 'reject'; reason: string; stop?: number; tp1?: number }
  | { decision: 'unavailable'; error: string };

export interface Reviewer {
  review(c: Candidate, ctx: { candles: Candle[]; ticker?: Ticker }): Promise<{ review: Review; costUsd: number }>;
}

const ReviewSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
  reason: z.string(),
  stop: z.number().optional(),
  tp1: z.number().optional(),
});

const SYSTEM_PROMPT = `Ти — досвідчений ф'ючерсний трейдер і ризик-менеджер. Тобі дають один торговий сетап (кандидат у сигнал) на USDT-M ф'ючерсах криптовалют: напрямок, зону входу, стоп, тейки, метрики та останні свічки робочого таймфрейму у форматі [ts, open, high, low, close, volume].

Завдання: оцінити саме цей сетап і вирішити — confirm (підтвердити) або reject (відхилити).
Відхиляй, якщо: дані суперечливі, ліквідність низька, вхід «в кінці руху» (ціна вже далеко відійшла від бази чи рівня), стоп надто близький або логічно не захищає ідею, співвідношення ризик/прибуток погане.
Поле reason — 1–2 речення українською, до 200 символів, без води.
Поля stop і tp1 заповнюй лише якщо коригування суттєво покращує сетап; інакше не вказуй їх. Стоп має лишатися по той бік зони входу, що й початковий, і не далі за початковий ліміт ризику.
Відповідай лише структурованим результатом.`;

const unavailable = (error: string): Review => ({ decision: 'unavailable', error });

function buildUser(c: Candidate, ctx: { candles: Candle[]; ticker?: Ticker }): string {
  const n = SIGNALS_CONFIG.claude.candlesInPrompt;
  return JSON.stringify({
    candidate: {
      mode: c.mode, symbol: c.symbol, direction: c.direction, timeframe: c.timeframe, pattern: c.pattern,
      entryLow: c.entryLow, entryHigh: c.entryHigh, stop: c.stop, tp1: c.tp1, tp2: c.tp2,
    },
    metrics: c.metrics,
    ticker: ctx.ticker,
    candles: ctx.candles.slice(-n).map((k) => [k.ts, k.open, k.high, k.low, k.close, k.volume]),
  });
}

// Максимальна відстань стопу в ATR для режиму (скальп без ліміту)
function stopCapAtr(mode: Candidate['mode']): number | null {
  if (mode === 'intraday') return SIGNALS_CONFIG.strategies.intraday.stopMaxAtrMult;
  if (mode === 'pump') return SIGNALS_CONFIG.strategies.pump.stopMaxAtrMult;
  return null;
}

function stopAcceptable(c: Candidate, stop: number): boolean {
  if (!Number.isFinite(stop)) return false;
  const rightSide = c.direction === 'long' ? stop < c.entryLow : stop > c.entryHigh;
  if (!rightSide) return false;
  const cap = stopCapAtr(c.mode);
  if (cap === null) return true;
  const atr = c.metrics.atr;
  if (!(atr > 0)) return false;
  const dist = Math.abs((c.entryLow + c.entryHigh) / 2 - stop);
  return dist <= cap * atr;
}

function tp1Acceptable(c: Candidate, tp1: number): boolean {
  if (!Number.isFinite(tp1)) return false;
  if (c.direction === 'long') return tp1 > c.entryHigh && (c.tp2 === null || tp1 < c.tp2);
  return tp1 < c.entryLow && (c.tp2 === null || tp1 > c.tp2);
}

export function createClaudeReviewer(client: Anthropic): Reviewer {
  return {
    async review(c, ctx) {
      const model = SIGNALS_CONFIG.modes[c.mode].model;
      const cfg = SIGNALS_CONFIG.claude;
      let costUsd = 0;
      try {
        const res = await client.messages.parse(
          {
            model,
            max_tokens: cfg.maxTokens,
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: buildUser(c, ctx) }],
            output_config: { effort: 'low', format: zodOutputFormat(ReviewSchema) },
          },
          { timeout: cfg.timeoutMs[model] ?? cfg.defaultTimeoutMs, maxRetries: cfg.maxRetries },
        );
        if (res.usage) costUsd = callCostUsd(model, res.usage);
        if (res.stop_reason === 'refusal') return { review: unavailable('refusal'), costUsd };
        const p = res.parsed_output;
        if (!p) return { review: unavailable('parse_failed'), costUsd };
        const review: Review = { decision: p.decision, reason: p.reason.slice(0, cfg.reasonMaxChars) };
        if (p.decision === 'confirm') {
          if (p.stop !== undefined && stopAcceptable(c, p.stop)) review.stop = p.stop;
          if (p.tp1 !== undefined && tp1Acceptable(c, p.tp1)) review.tp1 = p.tp1;
        }
        return { review, costUsd };
      } catch (e) {
        return { review: unavailable(e instanceof Error ? e.message : String(e)), costUsd };
      }
    },
  };
}
