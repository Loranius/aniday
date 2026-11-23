import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBitget, BitgetError } from '../../lib/signals/bitget';
import tickersFx from './fixtures/tickers.json';
import candlesFx from './fixtures/candles-btc-15m.json';

const ok = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('bitget client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1699999800000); // последня свічка (ts 1699999200000, 15m) ще не закрита
  });
  afterEach(() => vi.useRealTimers());

  it('maps tickers and computes openInterest = holdingAmount * lastPr', async () => {
    const f = vi.fn(() => ok(tickersFx)) as unknown as typeof fetch;
    const list = await createBitget(f).tickers();
    const btc = list.find((t) => t.symbol === 'BTCUSDT')!;
    expect(btc.last).toBe(60000);
    expect(btc.quoteVolume24h).toBe(2_000_000_000);
    expect(btc.change24h).toBe(0.01);
    expect(btc.fundingRate).toBe(0.00005);
    expect(btc.openInterest).toBeCloseTo(50000.5 * 60000);
    const url = String((f as any).mock.calls[0][0]);
    expect(url).toContain('/api/v2/mix/market/tickers');
    expect(url).toContain('productType=USDT-FUTURES');
  });

  it('sorts candles ascending and drops the unclosed last candle', async () => {
    const f = vi.fn(() => ok(candlesFx)) as unknown as typeof fetch;
    const c = await createBitget(f).candles('BTCUSDT', '15m', 100);
    expect(c).toHaveLength(4);
    for (let i = 1; i < c.length; i++) expect(c[i].ts).toBeGreaterThan(c[i - 1].ts);
    expect(c[c.length - 1].ts).toBe(1699999200000 - 900000);
    expect(c[0]).toMatchObject({ open: 60000, volume: 12.5, quoteVolume: 750000.5 });
    const url = String((f as any).mock.calls[0][0]);
    expect(url).toContain('granularity=15m');
    expect(url).toContain('limit=100');
  });

  it('keeps last candle when closed and passes startTime', async () => {
    vi.setSystemTime(1700000100000);
    const f = vi.fn(() => ok(candlesFx)) as unknown as typeof fetch;
    const c = await createBitget(f).candles('BTCUSDT', '15m', 100, 123);
    expect(c).toHaveLength(5);
    expect(String((f as any).mock.calls[0][0])).toContain('startTime=123');
  });

  it('throws BitgetError on non-00000 code', async () => {
    const f = (() => ok({ code: '40034', msg: 'Parameter does not exist', data: null })) as unknown as typeof fetch;
    await expect(createBitget(f).tickers()).rejects.toMatchObject({ name: 'BitgetError', code: '40034' });
    await expect(createBitget(f).tickers()).rejects.toBeInstanceOf(BitgetError);
  });

  it('throws BitgetError on HTTP != 200', async () => {
    const f = (() => ok({ code: '00000', data: [] }, 500)) as unknown as typeof fetch;
    await expect(createBitget(f).tickers()).rejects.toBeInstanceOf(BitgetError);
  });

  it('contract() maps fields and caches contracts', async () => {
    const body = {
      code: '00000',
      msg: 'success',
      data: [
        { symbol: 'BTCUSDT', pricePlace: '1', volumePlace: '2', minTradeNum: '0.01', maxLever: '125' },
        { symbol: 'ETHUSDT', pricePlace: '2', volumePlace: '2', minTradeNum: '0.01', maxLever: '100' },
      ],
    };
    const f = vi.fn(() => ok(body)) as unknown as typeof fetch;
    const b = createBitget(f);
    expect(await b.contract('BTCUSDT')).toEqual({ symbol: 'BTCUSDT', pricePlace: 1, volumePlace: 2, minTradeNum: 0.01, maxLeverage: 125 });
    expect((await b.contract('ETHUSDT')).maxLeverage).toBe(100);
    expect((f as any).mock.calls).toHaveLength(1);
    await expect(b.contract('NOPE')).rejects.toBeInstanceOf(BitgetError);
  });
});
