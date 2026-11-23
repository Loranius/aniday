import type { Prisma, PrismaClient } from './generated';
import { signalsPrisma } from './db';
import type { TrackState } from './outcome';
import type { StatRow } from './stats';
import type { Snapshot } from './universe';
import type { CloseReason, Direction, Mode, SignalGroup, SignalStatus } from './types';

const SNAPSHOT_KEEP_MS = 2 * 60 * 60_000;

export interface SettingsT {
  depositUsd: number;
  riskScalp: number;
  riskIntraday: number;
  riskPump: number;
  paused: Mode[];
  scalpDailyLimit: number;
}

// Усе, що потрібно для вставки сигналу; стан трекінгу — initialState()
export interface NewSignal extends TrackState {
  dedupeKey: string;
  mode: Mode;
  group: SignalGroup;
  symbol: string;
  timeframe: string;
  pattern: string;
  metrics: Record<string, number>;
  sizing: unknown;
  claudeReason: string | null;
}

export interface SignalRow extends TrackState {
  id: string;
  mode: Mode;
  group: SignalGroup;
  symbol: string;
  telegramMessageId: number | null;
  sizing: unknown;
  metrics: Record<string, number>;
}

export interface SignalsRepo {
  getSettings(): Promise<SettingsT>;
  updateSettings(p: Partial<SettingsT>): Promise<SettingsT>;
  insertSignal(s: NewSignal): Promise<{ id: string } | null>;
  hasActive(symbol: string, direction: Direction): Promise<boolean>;
  countSentToday(mode: Mode, dayStartMs: number): Promise<number>;
  listActive(): Promise<SignalRow[]>;
  saveTrackState(id: string, st: TrackState): Promise<void>;
  setMessageId(id: string, msgId: number): Promise<void>;
  statRows(sinceMs: number | null): Promise<StatRow[]>;
  addSpend(day: string, costUsd: number): Promise<void>;
  spendSince(dayFrom: string): Promise<number>;
  saveSnapshot(s: Snapshot): Promise<void>;
  recentSnapshots(sinceMs: number): Promise<Snapshot[]>;
}

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null);
const toDate = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));

function settingsFrom(r: {
  depositUsd: number;
  riskScalp: number;
  riskIntraday: number;
  riskPump: number;
  paused: string[];
  scalpDailyLimit: number;
}): SettingsT {
  return {
    depositUsd: r.depositUsd,
    riskScalp: r.riskScalp,
    riskIntraday: r.riskIntraday,
    riskPump: r.riskPump,
    paused: r.paused as Mode[],
    scalpDailyLimit: r.scalpDailyLimit,
  };
}

export function createRepo(db: PrismaClient = signalsPrisma): SignalsRepo {
  return {
    async getSettings() {
      const r = await db.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      return settingsFrom(r);
    },

    async updateSettings(p) {
      const r = await db.settings.upsert({ where: { id: 1 }, create: { id: 1, ...p }, update: p });
      return settingsFrom(r);
    },

    async insertSignal(s) {
      try {
        const r = await db.signal.create({
          data: {
            dedupeKey: s.dedupeKey,
            mode: s.mode,
            group: s.group,
            symbol: s.symbol,
            direction: s.direction,
            timeframe: s.timeframe,
            pattern: s.pattern,
            entryLow: s.entryLow,
            entryHigh: s.entryHigh,
            stop: s.stop,
            tp1: s.tp1,
            tp2: s.tp2,
            metrics: s.metrics as Prisma.InputJsonValue,
            sizing: s.sizing as Prisma.InputJsonValue,
            claudeReason: s.claudeReason,
            status: s.status,
            entryDeadline: new Date(s.entryDeadline),
            filledAt: toDate(s.filledAt),
            timeoutAt: toDate(s.timeoutAt),
            closedAt: toDate(s.closedAt),
            fillPrice: s.fillPrice,
            tp1Hit: s.tp1Hit,
            closeReason: s.closeReason,
            resultR: s.resultR,
            lastCheckedTs: BigInt(s.lastCheckedTs),
            createdAt: new Date(s.createdAt),
          },
          select: { id: true },
        });
        return { id: r.id };
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return null; // дубль dedupeKey
        throw e;
      }
    },

    async hasActive(symbol, direction) {
      const n = await db.signal.count({
        where: { symbol, direction, group: { not: 'shadow' }, status: { in: ['pending', 'open'] } },
      });
      return n > 0;
    },

    countSentToday(mode, dayStartMs) {
      return db.signal.count({
        where: { mode, group: { not: 'shadow' }, createdAt: { gte: new Date(dayStartMs) } },
      });
    },

    async listActive() {
      const rows = await db.signal.findMany({
        where: { status: { in: ['pending', 'open'] } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        mode: r.mode as Mode,
        group: r.group as SignalGroup,
        symbol: r.symbol,
        telegramMessageId: r.telegramMessageId,
        sizing: r.sizing,
        metrics: r.metrics as Record<string, number>,
        status: r.status as SignalStatus,
        direction: r.direction as Direction,
        entryLow: r.entryLow,
        entryHigh: r.entryHigh,
        stop: r.stop,
        tp1: r.tp1,
        tp2: r.tp2,
        createdAt: r.createdAt.getTime(),
        entryDeadline: r.entryDeadline.getTime(),
        filledAt: toMs(r.filledAt),
        fillPrice: r.fillPrice,
        tp1Hit: r.tp1Hit,
        timeoutAt: toMs(r.timeoutAt),
        closedAt: toMs(r.closedAt),
        closeReason: r.closeReason as CloseReason | null,
        resultR: r.resultR,
        lastCheckedTs: Number(r.lastCheckedTs),
      }));
    },

    async saveTrackState(id, st) {
      await db.signal.update({
        where: { id },
        data: {
          status: st.status,
          filledAt: toDate(st.filledAt),
          fillPrice: st.fillPrice,
          tp1Hit: st.tp1Hit,
          timeoutAt: toDate(st.timeoutAt),
          closedAt: toDate(st.closedAt),
          closeReason: st.closeReason,
          resultR: st.resultR,
          lastCheckedTs: BigInt(st.lastCheckedTs),
        },
      });
    },

    async setMessageId(id, msgId) {
      await db.signal.update({ where: { id }, data: { telegramMessageId: msgId } });
    },

    async statRows(sinceMs) {
      const rows = await db.signal.findMany({
        where: sinceMs === null ? {} : { createdAt: { gte: new Date(sinceMs) } },
        select: { mode: true, group: true, status: true, resultR: true, createdAt: true },
      });
      return rows.map((r) => ({
        mode: r.mode as Mode,
        group: r.group as SignalGroup,
        status: r.status as SignalStatus,
        resultR: r.resultR,
        createdAt: r.createdAt.getTime(),
      }));
    },

    async addSpend(day, costUsd) {
      await db.claudeSpend.upsert({
        where: { day },
        create: { day, costUsd, calls: 1 },
        update: { costUsd: { increment: costUsd }, calls: { increment: 1 } },
      });
    },

    async spendSince(dayFrom) {
      // дні у форматі YYYY-MM-DD порівнюються лексикографічно
      const r = await db.claudeSpend.aggregate({ where: { day: { gte: dayFrom } }, _sum: { costUsd: true } });
      return r._sum.costUsd ?? 0;
    },

    async saveSnapshot(s) {
      const data = s.bySymbol as unknown as Prisma.InputJsonValue;
      await db.marketSnapshot.upsert({
        where: { ts: new Date(s.ts) },
        create: { ts: new Date(s.ts), data },
        update: { data },
      });
      await db.marketSnapshot.deleteMany({ where: { ts: { lt: new Date(s.ts - SNAPSHOT_KEEP_MS) } } });
    },

    async recentSnapshots(sinceMs) {
      const rows = await db.marketSnapshot.findMany({
        where: { ts: { gte: new Date(sinceMs) } },
        orderBy: { ts: 'asc' },
      });
      return rows.map((r) => ({ ts: r.ts.getTime(), bySymbol: r.data as unknown as Snapshot['bySymbol'] }));
    },
  };
}

export const signalsRepo: SignalsRepo = createRepo();
