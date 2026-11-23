import { describe, it, expect, beforeEach } from 'vitest';
import { runScan } from '../../lib/signals/scan';
import { SIGNALS_CONFIG } from '../../lib/signals/config';
import type { Candle, Ticker } from '../../lib/signals/types';
import { FakeRepo, FakeMarket, FakeReviewer, FakeNotifier } from './fakes';

// Інтеграція зі СПРАВЖНІМИ детекторами; FakeMarket віддає не більше limit−1 закритих свічок
const T0 = 1_700_000_040_000;
function makeCandles(closes: number[], step: number, wick = 0.2, vol = 100): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      ts: T0 + i * step, open, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick,
      close, volume: vol, quoteVolume: vol * close,
    };
  });
}
const noise = (n: number, base = 100, amp = 0.3) => Array.from({ length: n }, (_, i) => base + amp * Math.sin(i * 0.9));
const withLast = (c: Candle[], patch: Partial<Candle>) => [...c.slice(0, -1), { ...c[c.length - 1], ...patch }];
const tk = (symbol: string, vol: number, last = 100): Ticker => ({
  symbol, last, quoteVolume24h: vol, change24h: 0.01, fundingRate: 0, openInterest: 1000,
});

let repo: FakeRepo, market: FakeMarket, reviewer: FakeReviewer, notifier: FakeNotifier, now: number;
const deps = () => ({ market, repo, reviewer, notifier, now: () => now });

beforeEach(() => {
  repo = new FakeRepo(); market = new FakeMarket(); reviewer = new FakeReviewer(); notifier = new FakeNotifier();
  market.honourLimit = true;
  now = T0 + 10 * 3_600_000;
});

describe('runScan зі справжніми детекторами', () => {
  it('scalp: breakout 5m породжує сигнал при запиті scalp1m/scalp5m', async () => {
    const cc = SIGNALS_CONFIG.scan.candles;
    market.tickerList = [tk('ETHUSDT', 9e9)];
    market.data.ETHUSDT = {
      '5m': withLast(makeCandles(noise(150), 300_000, 0.3), { open: 100, close: 101.5, high: 101.55, low: 99.9, volume: 500 }),
      '1m': makeCandles(new Array(150).fill(100), 60_000, 0.05),
    };
    const r = await runScan('scalp', deps());
    expect(market.calls.find((c) => c.g === '1m')!.limit).toBe(cc.scalp1m);
    expect(r[0]).toMatchObject({ mode: 'scalp', candidates: 1, sent: 1, errors: [] });
    expect(repo.signals[0]).toMatchObject({ mode: 'scalp', symbol: 'ETHUSDT', pattern: 'breakout' });
  });

  it('pump: сплеск + стиснення породжує сигнал при запиті pump15m', async () => {
    const cc = SIGNALS_CONFIG.scan.candles;
    const big = Array.from({ length: SIGNALS_CONFIG.universe.topN }, (_, i) => tk(`BIG${i}USDT`, 9e9 - i));
    market.tickerList = [...big, tk('XUSDT', 10_000_000, 101.5)];
    const c15 = withLast(
      makeCandles([...noise(110, 100, 1), ...new Array(39).fill(100), 100], 900_000, 0.5),
      { open: 100, close: 101.5, high: 101.7, low: 99.8, volume: 800 },
    );
    market.data.XUSDT = { '15m': c15 };
    // снапшоти ~15 і ~30 хв тому: обсяг XUSDT був нижчий → volBurst ≥ порогу
    for (const ago of [15, 30]) {
      repo.snapshots.push({ ts: now - ago * 60_000, bySymbol: { XUSDT: { quoteVolume24h: 9_000_000, openInterest: 1000 } } });
    }
    const r = await runScan('swing', deps());
    const pump = r.find((x) => x.mode === 'pump')!;
    expect(market.calls.find((c) => c.symbol === 'XUSDT')!.limit).toBe(cc.pump15m);
    expect(pump).toMatchObject({ candidates: 1, sent: 1, errors: [] });
    expect(repo.signals.find((s) => s.mode === 'pump')).toMatchObject({ symbol: 'XUSDT' });
  });
});
