import { describe, it, expect } from 'vitest';
import { sizePosition } from '../../lib/signals/sizing';
import type { ContractInfo } from '../../lib/signals/bitget';

const contract: ContractInfo = {
  symbol: 'SOLUSDT',
  pricePlace: 2,
  volumePlace: 1,
  minTradeNum: 0.1,
  maxLeverage: 50,
};

describe('sizePosition', () => {
  it('SOL long: стандартний розрахунок без попереджень', () => {
    const s = sizePosition({ direction: 'long', entry: 142.55, stop: 140.9, depositUsd: 500, riskPct: 2, contract });
    expect(s.riskUsd).toBe(10);
    expect(s.qty).toBe(6.0);
    expect(s.notionalUsd).toBeCloseTo(855.3, 2);
    expect(s.leverage).toBe(9);
    expect(s.marginUsd).toBeCloseTo(95.03, 2);
    expect(s.liquidationPrice).toBeLessThan(140.9);
    expect(s.liquidationPrice).toBeCloseTo(142.55 * (1 - 1 / 9 + 0.005), 2);
    expect(s.warnings).toEqual([]);
  });

  it('SOL short: дзеркально', () => {
    const s = sizePosition({ direction: 'short', entry: 142.55, stop: 144.2, depositUsd: 500, riskPct: 2, contract });
    expect(s.qty).toBe(6.0);
    expect(s.leverage).toBe(9);
    expect(s.liquidationPrice).toBeGreaterThan(144.2);
    expect(s.liquidationPrice).toBeCloseTo(142.55 * (1 + 1 / 9 - 0.005), 2);
    expect(s.warnings).toEqual([]);
  });

  it('дуже вузький стоп: плече впирається в 20 і є попередження про маржу', () => {
    const s = sizePosition({ direction: 'long', entry: 100, stop: 99.95, depositUsd: 500, riskPct: 2, contract });
    expect(s.leverage).toBe(20);
    expect(s.marginUsd).toBeGreaterThan(100);
    expect(s.warnings.some((w) => w.includes('маржа'))).toBe(true);
  });

  it('плече обмежене contract.maxLeverage', () => {
    const s = sizePosition({
      direction: 'long', entry: 100, stop: 99.95, depositUsd: 500, riskPct: 2,
      contract: { ...contract, maxLeverage: 10 },
    });
    expect(s.leverage).toBe(10);
  });

  it('riskPct 10: попередження про ризик', () => {
    const s = sizePosition({ direction: 'long', entry: 142.55, stop: 140.9, depositUsd: 500, riskPct: 10, contract });
    expect(s.warnings.some((w) => w.includes('ризик вище 5% на угоду'))).toBe(true);
  });

  it('ліквідація не далі за стоп: попередження (long)', () => {
    // ризик 40%, стоп 40 → qty 3.333, notional 333, lev 4, liq 75.5 >= stop 40
    const s = sizePosition({ direction: 'long', entry: 100, stop: 40, depositUsd: 500, riskPct: 40, contract: { ...contract, volumePlace: 3 } });
    expect(s.leverage).toBe(4);
    expect(s.liquidationPrice).toBeGreaterThanOrEqual(40);
    expect(s.warnings.some((w) => w.includes('ліквідац'))).toBe(true);
  });

  it('ліквідація не далі за стоп: попередження (short)', () => {
    const s = sizePosition({ direction: 'short', entry: 100, stop: 160, depositUsd: 500, riskPct: 40, contract: { ...contract, volumePlace: 3 } });
    expect(s.liquidationPrice).toBeLessThanOrEqual(160);
    expect(s.warnings.some((w) => w.includes('ліквідац'))).toBe(true);
  });

  it('qty < minTradeNum: попередження', () => {
    const s = sizePosition({
      direction: 'long', entry: 100, stop: 50, depositUsd: 10, riskPct: 1, contract: { ...contract, minTradeNum: 1 },
    });
    expect(s.qty).toBeLessThan(1);
    expect(s.warnings.some((w) => w.includes('мінімальн'))).toBe(true);
  });

  it('qty округлюється вниз без float-артефактів', () => {
    const s = sizePosition({ direction: 'long', entry: 10, stop: 9, depositUsd: 500, riskPct: 1.2, contract });
    // riskUsd 6, qty 6 → рівно 6
    expect(s.qty).toBe(6);
  });
});
