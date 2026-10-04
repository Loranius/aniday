import { describe, expect, it } from 'vitest';
import { calculateMaintenanceStatus, calculateNextService, compareByUrgency, deriveLastService } from '../maintenance';

const oil = { interval_km: 10_000, interval_days: 365 };

describe('calculateMaintenanceStatus', () => {
  it.each([
    [0.78, 'ok'],
    [0.9, 'soon'],
    [0.95, 'soon'],
    [0.98, 'due'],
    [1, 'due'],
    [1.02, 'overdue'],
    [null, 'unknown'],
  ] as const)('%s → %s', (p, s) => expect(calculateMaintenanceStatus(p)).toBe(s));
});

describe('calculateNextService', () => {
  const last = { odometer: 178_000, date: '2026-06-01' };

  it('OK at 7 800 / 10 000 km', () => {
    const r = calculateNextService(oil, last, 185_800, '2026-07-01');
    expect(r.status).toBe('ok');
    expect(r.kmSinceService).toBe(7800);
    expect(r.kmRemaining).toBe(2200);
    expect(r.dueOdometer).toBe(188_000);
  });

  it('Soon at 9 500 / 10 000 km', () => {
    expect(calculateNextService(oil, last, 187_500, '2026-07-01').status).toBe('soon');
  });

  it('Overdue at 10 200 / 10 000 km with negative remaining', () => {
    const r = calculateNextService(oil, last, 188_200, '2026-07-01');
    expect(r.status).toBe('overdue');
    expect(r.kmRemaining).toBe(-200);
  });

  it('time limit wins when it comes first (km OR months)', () => {
    const r = calculateNextService(oil, last, 179_000, '2027-06-10');
    expect(r.status).toBe('overdue');
    expect(r.limitingFactor).toBe('time');
    expect(r.dueDate).toBe('2027-06-01');
    expect(r.daysRemaining).toBe(-9);
  });

  it('time-only item (brake fluid, 2 years)', () => {
    const r = calculateNextService({ interval_km: null, interval_days: 730 }, { odometer: null, date: '2025-01-01' }, 190_000, '2026-11-01');
    expect(r.kmRemaining).toBeNull();
    expect(r.dueDate).toBe('2027-01-01');
    expect(r.daysRemaining).toBe(61);
    expect(r.status).toBe('soon');
  });

  it('unknown without a recorded service', () => {
    expect(calculateNextService(oil, { odometer: null, date: null }, 190_000, '2026-11-01').status).toBe('unknown');
  });

  it('service logged above the current odometer does not produce negative usage', () => {
    const r = calculateNextService(oil, { odometer: 186_000, date: '2026-10-01' }, 185_900, '2026-10-02');
    expect(r.kmSinceService).toBe(0);
    expect(r.kmRemaining).toBe(10_000);
    expect(r.status).toBe('ok');
  });
});

describe('deriveLastService', () => {
  it('a service done earlier than planned becomes the new baseline', () => {
    const events = [
      { maintenance_item_id: 'oil', date: '2026-01-10', odometer: 176_000 },
      { maintenance_item_id: 'oil', date: '2026-06-01', odometer: 181_500 }, // early change
      { maintenance_item_id: 'air', date: '2026-08-01', odometer: 183_000 },
    ];
    expect(deriveLastService('oil', events)).toEqual({ odometer: 181_500, date: '2026-06-01' });
    expect(deriveLastService('none', events)).toEqual({ odometer: null, date: null });
  });

  it('breaks same-day ties by odometer', () => {
    const events = [
      { maintenance_item_id: 'x', date: '2026-06-01', odometer: 100 },
      { maintenance_item_id: 'x', date: '2026-06-01', odometer: 200 },
    ];
    expect(deriveLastService('x', events).odometer).toBe(200);
  });
});

describe('compareByUrgency', () => {
  it('orders overdue before soon before ok', () => {
    const last = { odometer: 0, date: '2026-01-01' };
    const mk = (odo: number) => calculateNextService({ interval_km: 1000, interval_days: null }, last, odo, '2026-01-02');
    const sorted = [mk(100), mk(1100), mk(900)].sort(compareByUrgency).map((r) => r.status);
    expect(sorted).toEqual(['overdue', 'soon', 'ok']);
  });
});
