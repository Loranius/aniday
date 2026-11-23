import { describe, it, expect } from 'vitest';
import { computeStats, type StatRow } from '../../lib/signals/stats';

const rows: StatRow[] = [
  { mode: 'intraday', group: 'confirmed', status: 'closed', resultR: 2.25, createdAt: 1000 },
  { mode: 'intraday', group: 'confirmed', status: 'closed', resultR: -1, createdAt: 2000 },
  { mode: 'intraday', group: 'confirmed', status: 'closed', resultR: 0.75, createdAt: 3000 },
  { mode: 'intraday', group: 'confirmed', status: 'not_filled', resultR: null, createdAt: 4000 },
  { mode: 'intraday', group: 'confirmed', status: 'open', resultR: null, createdAt: 5000 },
];

describe('computeStats', () => {
  it('aggregates mode x group', () => {
    const r = computeStats(rows, null);
    const b = r.buckets.find((x) => x.mode === 'intraday' && x.group === 'confirmed')!;
    expect(b.total).toBe(5);
    expect(b.closed).toBe(3);
    expect(b.wins).toBe(2);
    expect(b.notFilled).toBe(1);
    expect(b.winRate).toBeCloseTo(2 / 3, 10);
    expect(b.sumR).toBeCloseTo(2.0, 10);
    expect(b.avgR).toBeCloseTo(0.667, 3);
    expect(r.byGroup.confirmed.closed).toBe(3);
    expect(r.byGroup.shadow.total).toBe(0);
  });
  it('sinceMs filters old rows', () => {
    const r = computeStats(rows, 2500);
    const b = r.byGroup.confirmed;
    expect(b.total).toBe(3);
    expect(b.closed).toBe(1);
    expect(b.sumR).toBeCloseTo(0.75, 10);
  });
  it('empty bucket has zeros', () => {
    const r = computeStats([], null);
    expect(r.byGroup.shadow).toEqual({ total: 0, notFilled: 0, closed: 0, wins: 0, winRate: 0, avgR: 0, sumR: 0 });
  });
});
