import type { KeyValueStore } from './storage';
import { readJson, writeJson } from './storage';
import { newId } from './ids';
import type { Trip, TripPoint } from '@/domain/types';

/**
 * Offline-first write path:  local change → persistent queue → (online) → Supabase.
 *
 * Every row carries a client-generated id and inserts are sent as
 * "insert … on conflict do nothing", so replaying an operation after a crash or a lost
 * response can never duplicate data (and never double-count kilometres).
 */

export type SyncTable =
  | 'vehicles'
  | 'odometer_entries'
  | 'trips'
  | 'saved_places'
  | 'maintenance_items'
  | 'maintenance_events'
  | 'fuel_entries';

type Row = Record<string, unknown> & { id: string };

export type SyncOp =
  | { id: string; createdAt: string; kind: 'insert'; table: SyncTable; rows: Row[] }
  | { id: string; createdAt: string; kind: 'update'; table: SyncTable; rowId: string; patch: Record<string, unknown> }
  | { id: string; createdAt: string; kind: 'delete'; table: SyncTable; rowId: string }
  | { id: string; createdAt: string; kind: 'trip'; trip: Trip; points: TripPoint[] };

export type NewSyncOp = SyncOp extends infer O ? (O extends SyncOp ? Omit<O, 'id' | 'createdAt'> : never) : never;

export interface FailedOp {
  op: SyncOp;
  error: string;
  failedAt: string;
}

/** Outcome of sending one operation. */
export type ApplyResult = { ok: true } | { ok: false; retryable: boolean; error: string };

export interface SyncTransport {
  apply(op: SyncOp): Promise<ApplyResult>;
}

export interface SyncState {
  pending: SyncOp[];
  failed: FailedOp[];
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const KEY = 'sync:queue:v1';
const FAILED_KEY = 'sync:failed:v1';

export class SyncQueue {
  private pending: SyncOp[] = [];
  private failed: FailedOp[] = [];
  private syncing = false;
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private listeners = new Set<(s: SyncState) => void>();
  private loaded: Promise<void>;
  private flushPromise: Promise<void> | null = null;

  constructor(
    private store: KeyValueStore,
    private transport: SyncTransport | null,
    private scope = 'default',
  ) {
    this.loaded = this.load();
  }

  private key(base: string) {
    return `${base}:${this.scope}`;
  }

  private async load() {
    this.pending = (await readJson<SyncOp[]>(this.store, this.key(KEY))) ?? [];
    this.failed = (await readJson<FailedOp[]>(this.store, this.key(FAILED_KEY))) ?? [];
    this.emit();
  }

  ready(): Promise<void> {
    return this.loaded;
  }

  private async persist() {
    await writeJson(this.store, this.key(KEY), this.pending);
    await writeJson(this.store, this.key(FAILED_KEY), this.failed);
  }

  getState(): SyncState {
    return {
      pending: [...this.pending],
      failed: [...this.failed],
      syncing: this.syncing,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
    };
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }

  /** Persists the operation before anything is sent, then tries to flush. */
  async enqueue(op: NewSyncOp): Promise<SyncOp> {
    await this.loaded;
    const full = { ...op, id: newId(), createdAt: new Date().toISOString() } as SyncOp;
    this.pending.push(full);
    await this.persist();
    this.emit();
    void this.flush();
    return full;
  }

  /** Sends operations in FIFO order. Stops at the first retryable failure (offline, 5xx, auth). */
  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async doFlush() {
    await this.loaded;
    if (!this.transport || this.pending.length === 0) return;
    this.syncing = true;
    this.emit();
    try {
      while (this.pending.length > 0) {
        const op = this.pending[0]!;
        let res: ApplyResult;
        try {
          res = await this.transport.apply(op);
        } catch (e) {
          res = { ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) };
        }
        if (!res.ok && res.retryable) {
          this.lastError = res.error;
          return;
        }
        this.pending.shift();
        if (!res.ok) {
          // Permanent rejection (validation / RLS). Keep it visible instead of silently dropping data.
          this.failed.push({ op, error: res.error, failedAt: new Date().toISOString() });
        }
        await this.persist();
        this.emit();
      }
      this.lastError = null;
      this.lastSyncedAt = new Date().toISOString();
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  /** Puts permanently failed operations back to the queue (e.g. after fixing data on the server). */
  async retryFailed() {
    await this.loaded;
    this.pending.push(...this.failed.map((f) => f.op));
    this.failed = [];
    await this.persist();
    this.emit();
    void this.flush();
  }

  async discardFailed() {
    this.failed = [];
    await this.persist();
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// Optimistic view: apply not-yet-synced operations on top of server data.
// ---------------------------------------------------------------------------

export type TableRows = Partial<Record<SyncTable, Row[]>>;

/** Pure: returns new arrays with pending ops applied (inserts are skipped if the id already exists). */
export function applyPendingOps(tables: TableRows, ops: readonly SyncOp[]): TableRows {
  const out: TableRows = {};
  for (const [k, v] of Object.entries(tables)) out[k as SyncTable] = [...(v ?? [])];
  const list = (t: SyncTable) => (out[t] ??= []);

  for (const op of ops) {
    switch (op.kind) {
      case 'insert': {
        const rows = list(op.table);
        for (const r of op.rows) if (!rows.some((x) => x.id === r.id)) rows.push(r);
        break;
      }
      case 'trip': {
        const rows = list('trips');
        if (!rows.some((x) => x.id === op.trip.id)) rows.push(op.trip as unknown as Row);
        break;
      }
      case 'update': {
        const rows = list(op.table);
        const i = rows.findIndex((x) => x.id === op.rowId);
        if (i >= 0) rows[i] = { ...rows[i]!, ...op.patch };
        break;
      }
      case 'delete': {
        out[op.table] = list(op.table).filter((x) => x.id !== op.rowId);
        break;
      }
    }
  }
  return out;
}
