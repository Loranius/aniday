import { describe, it, expect } from 'vitest';
import { callCostUsd, canSpend, kyivDay } from '../../lib/signals/budget';

describe('budget', () => {
  it('haiku cost', () => {
    expect(callCostUsd('claude-haiku-5-5', { input_tokens: 3000, output_tokens: 150 })).toBeCloseTo(0.000375, 9);
  });
  it('sonnet cost', () => {
    expect(callCostUsd('claude-sonnet-5-5', { input_tokens: 3000, output_tokens: 150 })).toBeCloseTo(0.0075, 9);
  });
  it('cache tokens', () => {
    const c = callCostUsd('claude-sonnet-5-5', {
      input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    });
    expect(c).toBeCloseTo(0.2 + 2.5, 9);
  });
  it('unknown model costs 0', () => {
    expect(callCostUsd('x', { input_tokens: 10, output_tokens: 10 })).toBe(0);
  });
  it('canSpend', () => {
    expect(canSpend(0.66, 5)).toBe(false);
    expect(canSpend(0.1, 19.99)).toBe(false);
    expect(canSpend(0.1, 5)).toBe(true);
  });
  it('kyivDay', () => {
    expect(kyivDay(Date.parse('2026-11-23T22:30:00Z'))).toBe('2026-11-24');
    expect(kyivDay(Date.parse('2026-11-23T21:30:00Z'))).toBe('2026-11-23');
  });
});

import { kyivDayStartMs } from '../../lib/signals/budget';
describe('kyivDayStartMs', () => {
  it('зима (UTC+2)', () => {
    expect(kyivDayStartMs(Date.UTC(2026, 0, 15, 12))).toBe(Date.UTC(2026, 0, 14, 22));
  });
  it('літо (UTC+3)', () => {
    expect(kyivDayStartMs(Date.UTC(2026, 6, 15, 12))).toBe(Date.UTC(2026, 6, 14, 21));
  });
  it('доба переходу на літній час (29.03.2026): початок за зимовим, наступна доба за літнім', () => {
    expect(kyivDayStartMs(Date.UTC(2026, 2, 29, 12))).toBe(Date.UTC(2026, 2, 28, 22));
    expect(kyivDayStartMs(Date.UTC(2026, 2, 30, 12))).toBe(Date.UTC(2026, 2, 29, 21));
  });
  it('23:30 UTC взимку вже наступна київська доба', () => {
    expect(kyivDayStartMs(Date.UTC(2026, 0, 15, 23, 30))).toBe(Date.UTC(2026, 0, 15, 22));
  });
});
