import { SIGNALS_CONFIG } from './config';
import type { Candle, Candidate, CloseReason, Direction, Mode, SignalStatus } from './types';

const MIN = 60_000;

export interface TrackState {
  status: SignalStatus;
  direction: Direction;
  entryLow: number;
  entryHigh: number;
  stop: number;
  tp1: number;
  tp2: number | null;
  createdAt: number;
  entryDeadline: number;
  filledAt: number | null;
  fillPrice: number | null;
  tp1Hit: boolean;
  timeoutAt: number | null;
  closedAt: number | null;
  closeReason: CloseReason | null;
  resultR: number | null;
  lastCheckedTs: number;
}

export function initialState(c: Candidate, mode: Mode, createdAt: number): TrackState {
  return {
    status: 'pending',
    direction: c.direction,
    entryLow: c.entryLow,
    entryHigh: c.entryHigh,
    stop: c.stop,
    tp1: c.tp1,
    tp2: c.tp2,
    createdAt,
    entryDeadline: createdAt + SIGNALS_CONFIG.modes[mode].entryWindowMin * MIN,
    filledAt: null,
    fillPrice: null,
    tp1Hit: false,
    timeoutAt: null,
    closedAt: null,
    closeReason: null,
    resultR: null,
    lastCheckedTs: c.candleTs,
  };
}

// Рух у R у бік угоди (для short знак дзеркальний)
function moveR(dir: Direction, fill: number, price: number, risk: number): number {
  return ((dir === 'long' ? price - fill : fill - price)) / risk;
}

function close(s: TrackState, ts: number, reason: CloseReason, r: number): void {
  s.status = 'closed';
  s.closedAt = ts;
  s.closeReason = reason;
  s.resultR = r;
}

export function advance(state: TrackState, candles: Candle[], mode: Mode, now: number): TrackState {
  const s: TrackState = { ...state };
  if (s.status === 'closed' || s.status === 'not_filled') return s;
  const long = s.direction === 'long';
  const timeoutMs = SIGNALS_CONFIG.modes[mode].timeoutMin * MIN;

  for (const k of candles) {
    if (k.ts <= s.lastCheckedTs) continue;
    if (s.status !== 'pending' && s.status !== 'open') break;

    if (s.status === 'pending') {
      if (k.ts > s.entryDeadline) {
        s.status = 'not_filled';
        s.closedAt = s.entryDeadline;
        s.lastCheckedTs = k.ts;
        break;
      }
      const touched = long ? k.low <= s.entryHigh : k.high >= s.entryLow;
      s.lastCheckedTs = k.ts;
      if (!touched) continue;
      s.status = 'open';
      s.fillPrice = (s.entryLow + s.entryHigh) / 2;
      s.filledAt = k.ts;
      s.timeoutAt = k.ts + timeoutMs;
      // на свічці входу перевіряється лише стоп
      if (long ? k.low <= s.stop : k.high >= s.stop) close(s, k.ts, 'stop', -1);
      continue;
    }

    // open
    s.lastCheckedTs = k.ts;
    const fill = s.fillPrice as number;
    const risk = Math.abs(fill - s.stop);
    // після TP1 стоп = ціна входу
    const stopLevel = s.tp1Hit ? fill : s.stop;
    const realized = s.tp1Hit ? 0.5 * moveR(s.direction, fill, s.tp1, risk) : 0;

    if (s.timeoutAt !== null && k.ts >= s.timeoutAt) {
      const remaining = s.tp1Hit ? 0.5 : 1;
      close(s, k.ts, 'timeout', realized + remaining * moveR(s.direction, fill, k.close, risk));
      continue;
    }
    const stopHit = long ? k.low <= stopLevel : k.high >= stopLevel;
    if (stopHit) {
      if (s.tp1Hit) close(s, k.ts, 'breakeven', realized);
      else close(s, k.ts, 'stop', -1);
      continue;
    }
    const reached = (p: number) => (long ? k.high >= p : k.low <= p);
    if (!s.tp1Hit) {
      if (!reached(s.tp1)) continue;
      if (s.tp2 === null) {
        close(s, k.ts, 'tp', moveR(s.direction, fill, s.tp1, risk));
        continue;
      }
      s.tp1Hit = true;
      // s.stop лишається початковим (з нього рахується risk); ефективний стоп = fill, див. stopLevel
      // TP1 і TP2 в одній свічці без торкання стопу — TP2
      if (reached(s.tp2)) {
        close(s, k.ts, 'tp2', 0.5 * moveR(s.direction, fill, s.tp1, risk) + 0.5 * moveR(s.direction, fill, s.tp2, risk));
      }
      continue;
    }
    if (s.tp2 !== null && reached(s.tp2)) {
      close(s, k.ts, 'tp2', realized + 0.5 * moveR(s.direction, fill, s.tp2, risk));
    }
  }

  if (s.status === 'pending' && now > s.entryDeadline) {
    s.status = 'not_filled';
    s.closedAt = s.entryDeadline;
  }
  return s;
}
