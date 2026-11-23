import { describe, it, expect } from 'vitest';
import { SIGNALS_CONFIG } from '../../lib/signals/config';

const { candles } = SIGNALS_CONFIG.scan;
const S = SIGNALS_CONFIG.strategies;

// Кожна пара режим/таймфрейм: запит − 1 (відкинута свічка, що формується) ≥ мінімуму детектора
const pairs: Array<[string, number, number]> = [
  ['intraday 15m', candles.intraday15m, S.intraday.minCandles15m],
  ['intraday 1h', candles.intraday1h, S.intraday.minCandles1h],
  ['pump 15m', candles.pump15m, S.pump.minCandles15m],
  ['scalp 5m', candles.scalp5m, S.scalp.minCandles5m],
  ['scalp 1m', candles.scalp1m, S.scalp.minCandles1m],
];

describe('scan.candles vs мінімуми детекторів', () => {
  it.each(pairs)('%s: запит − 1 ≥ мінімум', (_name, requested, min) => {
    expect(requested - 1).toBeGreaterThanOrEqual(min);
  });
});
