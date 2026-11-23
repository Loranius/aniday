import type { Deps } from './scan';
import type { SignalRow } from './repo';
import { advance, type TrackState } from './outcome';
import { formatClose } from './telegram';
import { SIGNALS_CONFIG } from './config';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEYS: (keyof TrackState)[] = [
  'status', 'direction', 'entryLow', 'entryHigh', 'stop', 'tp1', 'tp2', 'createdAt', 'entryDeadline', 'filledAt',
  'fillPrice', 'tp1Hit', 'timeoutAt', 'closedAt', 'closeReason', 'resultR', 'lastCheckedTs',
];
const changed = (a: TrackState, b: TrackState) => KEYS.some((k) => a[k] !== b[k]);

// closed у звіті = закриті угоди + not_filled (обидва — завершення сигналу)
export async function runTracking(deps: Deps): Promise<{ checked: number; closed: number; errors: string[] }> {
  const { market, repo, notifier, now } = deps;
  const out = { checked: 0, closed: 0, errors: [] as string[] };
  const rows = await repo.listActive();
  const bySymbol = new Map<string, SignalRow[]>();
  for (const r of rows) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r]);

  const { candleLimit, fiveMinGapHours } = SIGNALS_CONFIG.tracking;
  await Promise.all(
    [...bySymbol].map(async ([symbol, group]) => {
      try {
        const t = now();
        const minChecked = Math.min(...group.map((r) => r.lastCheckedTs));
        const gran = t - minChecked > fiveMinGapHours * 3_600_000 ? '5m' : '1m';
        const candles = await market.candles(symbol, gran, candleLimit, minChecked + 1);
        for (const row of group) {
          out.checked++;
          const next = advance(row, candles, row.mode, t);
          if (!changed(row, next)) continue;
          await repo.saveTrackState(row.id, next);
          const finished = next.status === 'closed' || next.status === 'not_filled';
          if (!finished) continue;
          out.closed++;
          if (row.group === 'shadow') continue;
          await notifier.send(formatClose({ ...row, ...next }), row.telegramMessageId ?? undefined);
        }
      } catch (e) {
        out.errors.push(`${symbol}: ${errMsg(e)}`);
      }
    }),
  );
  return out;
}
