import { describe, expect, it } from 'vitest';
import { applyPendingOps, SyncQueue, type ApplyResult, type SyncOp, type SyncTransport } from '../syncQueue';
import { memoryStore } from '../storage';
import type { Trip } from '@/domain/types';

/** Fake server with "insert … on conflict do nothing" semantics. */
class FakeServer implements SyncTransport {
  rows = new Map<string, unknown>();
  online = true;
  calls = 0;
  reject: string | null = null;
  async apply(op: SyncOp): Promise<ApplyResult> {
    this.calls++;
    if (!this.online) return { ok: false, retryable: true, error: 'offline' };
    if (this.reject) return { ok: false, retryable: false, error: this.reject };
    if (op.kind === 'trip' && !this.rows.has(op.trip.id)) this.rows.set(op.trip.id, op.trip);
    if (op.kind === 'insert') for (const r of op.rows) if (!this.rows.has(r.id)) this.rows.set(r.id, r);
    return { ok: true };
  }
}

const trip = (id: string, km: number) => ({ id, vehicle_id: 'v', distance_km: km, is_valid: true, ended_at: '2026-10-01T10:00:00Z' }) as Trip;
const settle = (q: SyncQueue) => q.flush();

describe('SyncQueue', () => {
  it('keeps operations while offline and sends them when back online', async () => {
    const server = new FakeServer();
    server.online = false;
    const store = memoryStore();
    const q = new SyncQueue(store, server);
    await q.enqueue({ kind: 'trip', trip: trip('t1', 10), points: [] });
    await settle(q);
    expect(q.getState().pending).toHaveLength(1);
    expect(server.rows.size).toBe(0);

    // app restarted while offline: queue is restored from storage
    const q2 = new SyncQueue(store, server);
    await q2.ready();
    expect(q2.getState().pending).toHaveLength(1);

    server.online = true;
    await q2.flush();
    expect(q2.getState().pending).toHaveLength(0);
    expect(server.rows.size).toBe(1);
  });

  it('replaying the same trip (lost response / double tap) does not duplicate it', async () => {
    const server = new FakeServer();
    const q = new SyncQueue(memoryStore(), server);
    const t = trip('same', 21.3);
    await q.enqueue({ kind: 'trip', trip: t, points: [] });
    await q.enqueue({ kind: 'trip', trip: t, points: [] });
    await settle(q);
    expect(server.rows.size).toBe(1);
  });

  it('moves permanently rejected operations to the failed list instead of dropping them', async () => {
    const server = new FakeServer();
    server.reject = '23514: check violation';
    const q = new SyncQueue(memoryStore(), server);
    await q.enqueue({ kind: 'insert', table: 'fuel_entries', rows: [{ id: 'f1' }] });
    await settle(q);
    expect(q.getState().pending).toHaveLength(0);
    expect(q.getState().failed[0]?.error).toContain('check violation');
    server.reject = null;
    await q.retryFailed();
    await settle(q);
    expect(q.getState().failed).toHaveLength(0);
    expect(server.rows.has('f1')).toBe(true);
  });

  it('preserves FIFO order (vehicle before its trips)', async () => {
    const order: string[] = [];
    const q = new SyncQueue(memoryStore(), {
      async apply(op) {
        order.push(op.kind === 'insert' ? op.table : op.kind);
        return { ok: true };
      },
    });
    await q.enqueue({ kind: 'insert', table: 'vehicles', rows: [{ id: 'v' }] });
    await q.enqueue({ kind: 'trip', trip: trip('t', 1), points: [] });
    await settle(q);
    expect(order).toEqual(['vehicles', 'trip']);
  });
});

describe('applyPendingOps', () => {
  it('merges unsynced inserts/updates/deletes over server rows without duplicates', () => {
    const now = '2026-10-01T00:00:00Z';
    const ops: SyncOp[] = [
      { id: '1', createdAt: now, kind: 'trip', trip: trip('t2', 5), points: [] },
      { id: '2', createdAt: now, kind: 'trip', trip: trip('t1', 99), points: [] }, // already on server
      { id: '3', createdAt: now, kind: 'update', table: 'trips', rowId: 't1', patch: { is_valid: false } },
      { id: '4', createdAt: now, kind: 'delete', table: 'fuel_entries', rowId: 'f1' },
    ];
    const out = applyPendingOps({ trips: [{ ...trip('t1', 10) }], fuel_entries: [{ id: 'f1' }] }, ops);
    expect(out.trips).toHaveLength(2);
    expect(out.trips?.find((t) => t.id === 't1')).toMatchObject({ distance_km: 10, is_valid: false });
    expect(out.fuel_entries).toHaveLength(0);
  });
});
