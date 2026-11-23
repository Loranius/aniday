import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createClaudeReviewer } from '../../lib/signals/claude';
import type { Candidate, Candle } from '../../lib/signals/types';

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  mode: 'intraday', symbol: 'BTCUSDT', direction: 'long', timeframe: '15m', candleTs: 1,
  entryLow: 100, entryHigh: 101, stop: 98, tp1: 104, tp2: 108, pattern: 'pullback',
  metrics: { atr: 1 }, ...o,
});
const candles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
  ts: i * 900000, open: 100, high: 101, low: 99, close: 100, volume: 10, quoteVolume: 1000,
}));
const usage = { input_tokens: 3000, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const mk = (res: unknown, reject = false) => {
  const parse = reject ? vi.fn().mockRejectedValue(res) : vi.fn().mockResolvedValue(res);
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
};

describe('claude reviewer', () => {
  it('confirm with cost', async () => {
    const { client, parse } = mk({ parsed_output: { decision: 'confirm', reason: 'ok' }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'ok' });
    expect(r.costUsd).toBeCloseTo(0.0075, 9);
    const [params, opts] = parse.mock.calls[0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.max_tokens).toBe(2000);
    expect(params.output_config.effort).toBe('low');
    expect(params.temperature).toBeUndefined();
    expect(opts).toEqual({ timeout: 20000, maxRetries: 0 });
    const user = JSON.parse(params.messages[0].content);
    expect(user.candles).toHaveLength(40);
  });
  it('haiku timeout for scalp', async () => {
    const { client, parse } = mk({ parsed_output: { decision: 'reject', reason: 'x' }, stop_reason: 'end_turn', usage });
    await createClaudeReviewer(client).review(cand({ mode: 'scalp' }), { candles });
    expect(parse.mock.calls[0][0].model).toBe('claude-haiku-5-5');
    expect(parse.mock.calls[0][1].timeout).toBe(10000);
  });
  it('reject passes through', async () => {
    const { client } = mk({ parsed_output: { decision: 'reject', reason: 'слабко' }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review).toEqual({ decision: 'reject', reason: 'слабко' });
  });
  it('connection error -> unavailable, cost 0', async () => {
    const { client } = mk(new Anthropic.APIConnectionError({ message: 'down' }), true);
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review.decision).toBe('unavailable');
    expect(r.costUsd).toBe(0);
  });
  it('timeout -> unavailable', async () => {
    const { client } = mk(new Anthropic.APIConnectionTimeoutError(), true);
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review.decision).toBe('unavailable');
  });
  it('refusal -> unavailable with cost', async () => {
    const { client } = mk({ parsed_output: null, stop_reason: 'refusal', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review.decision).toBe('unavailable');
    expect(r.costUsd).toBeCloseTo(0.0075, 9);
  });
  it('parsed_output null -> unavailable', async () => {
    const { client } = mk({ parsed_output: null, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review.decision).toBe('unavailable');
  });
  it('valid adjusted stop/tp1 accepted', async () => {
    const { client } = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 99, tp1: 105 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r', stop: 99, tp1: 105 });
  });
  it('stop on wrong side ignored', async () => {
    const { client } = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 102, tp1: 105 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r', tp1: 105 });
  });
  it('stop beyond 3 ATR ignored (intraday)', async () => {
    const { client } = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 95 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r' });
  });
  it('обрізання reason не розриває сурогатні пари', async () => {
    const reason = '😀'.repeat(250);
    const { client } = mk({ parsed_output: { decision: 'reject', reason }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand(), { candles });
    const out = (r.review as { reason: string }).reason;
    expect(Array.from(out)).toHaveLength(200);
    expect(out).toBe('😀'.repeat(200));
  });
  it('short: stop must be above zone', async () => {
    const { client } = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 99 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand({ direction: 'short', stop: 103, tp1: 96 }), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r' });
  });
  it('scalp has no distance cap', async () => {
    const { client } = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 90 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(client).review(cand({ mode: 'scalp' }), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r', stop: 90 });
  });
  it('tp1 wrong side ignored (long and short)', async () => {
    const a = mk({ parsed_output: { decision: 'confirm', reason: 'r', tp1: 100.5 }, stop_reason: 'end_turn', usage });
    expect((await createClaudeReviewer(a.client).review(cand(), { candles })).review).toEqual({ decision: 'confirm', reason: 'r' });
    const b = mk({ parsed_output: { decision: 'confirm', reason: 'r', tp1: 102 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(b.client).review(cand({ direction: 'short', stop: 103, tp1: 96, tp2: 92 }), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r' });
  });
  it('tp1 beyond tp2 ignored', async () => {
    const a = mk({ parsed_output: { decision: 'confirm', reason: 'r', tp1: 109 }, stop_reason: 'end_turn', usage });
    expect((await createClaudeReviewer(a.client).review(cand(), { candles })).review).toEqual({ decision: 'confirm', reason: 'r' });
    const b = mk({ parsed_output: { decision: 'confirm', reason: 'r', tp1: 91 }, stop_reason: 'end_turn', usage });
    const r = await createClaudeReviewer(b.client).review(cand({ direction: 'short', stop: 103, tp1: 96, tp2: 92 }), { candles });
    expect(r.review).toEqual({ decision: 'confirm', reason: 'r' });
  });
  it('stop cap measured from entry midpoint (boundary)', async () => {
    // mid 100.5, atr 1 -> cap 3 => 97.5 ok, 97.4 rejected
    const ok = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 97.5 }, stop_reason: 'end_turn', usage });
    expect((await createClaudeReviewer(ok.client).review(cand(), { candles })).review).toEqual({ decision: 'confirm', reason: 'r', stop: 97.5 });
    const bad = mk({ parsed_output: { decision: 'confirm', reason: 'r', stop: 97.4 }, stop_reason: 'end_turn', usage });
    expect((await createClaudeReviewer(bad.client).review(cand(), { candles })).review).toEqual({ decision: 'confirm', reason: 'r' });
  });
});
