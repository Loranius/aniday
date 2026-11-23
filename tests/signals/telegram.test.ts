import { describe, it, expect, vi } from 'vitest';
import { createTelegram, formatSignal, formatClose, formatStats } from '../../lib/signals/telegram';
import type { Candidate } from '../../lib/signals/types';
import type { Sizing } from '../../lib/signals/sizing';
import type { SignalRow } from '../../lib/signals/repo';
import { computeStats } from '../../lib/signals/stats';

const cand: Candidate = {
  mode: 'intraday', symbol: 'SOLUSDT', direction: 'long', timeframe: '15m', candleTs: 0,
  entryLow: 142.3, entryHigh: 142.8, stop: 140.9, tp1: 144.7, tp2: 146.9, pattern: 'pullback', metrics: {},
};
const sizing: Sizing = {
  riskUsd: 10, qty: 0.7, notionalUsd: 100, leverage: 9, marginUsd: 11.11, liquidationPrice: 115.1, warnings: [],
};
// 2026-11-23 14:15 UTC = 16:15 Kyiv (EET, UTC+2)
const deadline = Date.UTC(2026, 10, 23, 14, 15);

describe('formatSignal', () => {
  it('long з Claude', () => {
    const t = formatSignal(cand, sizing, 'confirmed', 'відкат до EMA50', deadline, 2, 2);
    expect(t).toContain('🟢 LONG SOLUSDT');
    expect(t).toContain('інтрадей 15m');
    expect(t).toContain('142.30–142.80');
    expect(t).toContain('плече 9x');
    expect(t).toContain('Claude: відкат до EMA50');
    expect(t).toContain('Вхід дійсний до: 23.11 16:15');
    expect(t).toContain('✅');
    expect(t).toContain('TP2: 146.90');
    expect(t).toContain('(2%)');
  });
  it('no_claude', () => {
    expect(formatSignal(cand, sizing, 'no_claude', null, deadline, 2)).toContain('⚠️ без перевірки Claude');
  });
  it('екранує HTML і показує попередження', () => {
    const t = formatSignal(cand, { ...sizing, warnings: ['a<b'] }, 'confirmed', '<b>&x', deadline, 2);
    expect(t).toContain('&lt;b&gt;&amp;x');
    expect(t).toContain('a&lt;b');
    expect(t).not.toContain('<b>');
  });
  it('short, pump, ліквідація ⚠️, без tp2', () => {
    const t = formatSignal(
      { ...cand, mode: 'pump', direction: 'short', stop: 143.5, tp1: 140, tp2: null },
      { ...sizing, liquidationPrice: 142 }, 'confirmed', 'x', deadline, 2);
    expect(t).toContain('🔴 SHORT');
    expect(t).toContain('🚀 висока волатильність');
    expect(t).toContain('⚠️');
    expect(t).not.toContain('TP2');
  });
});

const base = {
  id: '1', mode: 'intraday', group: 'confirmed', symbol: 'SOLUSDT', telegramMessageId: 5, sizing: null, metrics: {},
  status: 'closed', direction: 'long', entryLow: 1, entryHigh: 2, stop: 0.5, tp1: 3, tp2: 4, createdAt: 0,
  entryDeadline: 0, filledAt: 0, fillPrice: 1, tp1Hit: true, timeoutAt: 0, closedAt: 0, closeReason: null,
  resultR: null, lastCheckedTs: 0,
} as unknown as SignalRow;

describe('formatClose', () => {
  it('варіанти', () => {
    expect(formatClose({ ...base, closeReason: 'breakeven', resultR: 0.75 })).toBe('➖ SOLUSDT LONG: беззбиток +0.75R');
    expect(formatClose({ ...base, closeReason: 'tp2', resultR: 2.25 })).toBe('✅ SOLUSDT LONG: TP2 +2.25R');
    expect(formatClose({ ...base, closeReason: 'stop', resultR: -1 })).toBe('❌ SOLUSDT LONG: стоп −1R');
    expect(formatClose({ ...base, closeReason: 'timeout', resultR: 0.4 })).toContain('таймаут +0.4R');
    expect(formatClose({ ...base, status: 'not_filled' })).toContain('⌛');
  });
});

describe('formatStats', () => {
  it('містить режими, групи і витрати', () => {
    const r = computeStats([{ mode: 'scalp', group: 'confirmed', status: 'closed', resultR: 1, createdAt: 1 }], null);
    const t = formatStats(r, 3.456);
    expect(t).toContain('scalp');
    expect(t).toContain('$3.46');
    expect(t).toContain('shadow');
  });
});

describe('createTelegram', () => {
  it('шле sendMessage і повертає message_id', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) });
    const id = await createTelegram('TOK', '99', f as any).send('hi', 7);
    expect(id).toBe(42);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTOK/sendMessage');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: '99', text: 'hi', parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: 7 });
  });
  it('не кидає на помилці', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'x', json: async () => ({}) });
    expect(await createTelegram('T', '1', bad as any).send('a')).toBeNull();
    const net = vi.fn().mockRejectedValue(new Error('net'));
    expect(await createTelegram('T', '1', net as any).send('a')).toBeNull();
    spy.mockRestore();
  });
});
