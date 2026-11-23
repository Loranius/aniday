import type { Mode, SignalGroup, SignalStatus } from './types';

export interface StatRow {
  mode: Mode;
  group: SignalGroup;
  status: SignalStatus;
  resultR: number | null;
  createdAt: number;
}

export interface Bucket {
  total: number;
  notFilled: number;
  closed: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  sumR: number;
}

export interface StatsReport {
  buckets: Array<Bucket & { mode: Mode; group: SignalGroup }>;
  byGroup: Record<SignalGroup, Bucket>;
}

const MODES: Mode[] = ['scalp', 'intraday', 'pump'];
const GROUPS: SignalGroup[] = ['confirmed', 'shadow', 'no_claude'];

function bucket(rows: StatRow[]): Bucket {
  let notFilled = 0;
  let closed = 0;
  let wins = 0;
  let sumR = 0;
  for (const r of rows) {
    if (r.status === 'not_filled') notFilled++;
    else if (r.status === 'closed' && r.resultR !== null) {
      closed++;
      sumR += r.resultR;
      if (r.resultR > 0) wins++;
    }
  }
  return {
    total: rows.length,
    notFilled,
    closed,
    wins,
    winRate: closed ? wins / closed : null,
    avgR: closed ? sumR / closed : null,
    sumR,
  };
}

export function computeStats(rows: StatRow[], sinceMs: number | null): StatsReport {
  const f = sinceMs === null ? rows : rows.filter((r) => r.createdAt >= sinceMs);
  const buckets: StatsReport['buckets'] = [];
  for (const mode of MODES) {
    for (const group of GROUPS) {
      buckets.push({ mode, group, ...bucket(f.filter((r) => r.mode === mode && r.group === group)) });
    }
  }
  const byGroup = {} as Record<SignalGroup, Bucket>;
  for (const g of GROUPS) byGroup[g] = bucket(f.filter((r) => r.group === g));
  return { buckets, byGroup };
}
