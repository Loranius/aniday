import type { Candle, Ticker } from './types';

// Публічні ринкові дані Bitget USDT-M futures (без ключів)
const BASE = 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';
const TIMEOUT_MS = 8000;
const MAX_PARALLEL = 10;
const CONTRACTS_TTL_MS = 60 * 60 * 1000;

export type Granularity = '1m' | '5m' | '15m' | '1H';
const TF_MS: Record<Granularity, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1H': 3_600_000 };

export interface ContractInfo {
  symbol: string;
  pricePlace: number;
  volumePlace: number;
  minTradeNum: number;
  maxLeverage: number;
}

export interface MarketData {
  tickers(): Promise<Ticker[]>;
  candles(symbol: string, granularity: Granularity, limit: number, startTime?: number): Promise<Candle[]>;
  contract(symbol: string): Promise<ContractInfo>;
}

export class BitgetError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(`Bitget ${code}: ${msg}`);
    this.name = 'BitgetError';
    this.code = code;
  }
}

// Простий семафор: не більше MAX_PARALLEL одночасних запитів
let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < MAX_PARALLEL) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function release(): void {
  const next = waiters.shift();
  if (next) next(); // слот передається далі
  else active--;
}

let contractsCache: { at: number; map: Map<string, ContractInfo> } | null = null;

export function createBitget(fetchImpl: typeof fetch = fetch): MarketData {
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    await acquire();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${BASE}${path}?${qs}`, { signal: ctrl.signal });
      let body: { code?: string; msg?: string; data?: unknown } = {};
      try {
        body = await res.json();
      } catch {
        // не JSON
      }
      if (res.status !== 200) throw new BitgetError(body.code ?? String(res.status), body.msg ?? `HTTP ${res.status}`);
      if (body.code !== '00000') throw new BitgetError(String(body.code), String(body.msg));
      return body.data;
    } catch (e) {
      if (e instanceof BitgetError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw new BitgetError('TIMEOUT', `timeout ${TIMEOUT_MS}ms ${path}`);
      throw e;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  async function loadContracts(): Promise<Map<string, ContractInfo>> {
    if (contractsCache && Date.now() - contractsCache.at < CONTRACTS_TTL_MS) return contractsCache.map;
    const data = (await get('/api/v2/mix/market/contracts', { productType: PRODUCT })) as Array<Record<string, string>>;
    const map = new Map<string, ContractInfo>();
    for (const c of data) {
      map.set(c.symbol, {
        symbol: c.symbol,
        pricePlace: Number(c.pricePlace),
        volumePlace: Number(c.volumePlace),
        minTradeNum: Number(c.minTradeNum),
        maxLeverage: Number(c.maxLever),
      });
    }
    contractsCache = { at: Date.now(), map };
    return map;
  }

  return {
    async tickers() {
      const data = (await get('/api/v2/mix/market/tickers', { productType: PRODUCT })) as Array<Record<string, string>>;
      return data.map((t) => {
        const last = Number(t.lastPr);
        return {
          symbol: t.symbol,
          last,
          quoteVolume24h: Number(t.usdtVolume),
          change24h: Number(t.change24h),
          fundingRate: Number(t.fundingRate),
          openInterest: Number(t.holdingAmount) * last,
        };
      });
    },

    async candles(symbol, granularity, limit, startTime) {
      const params: Record<string, string> = { symbol, productType: PRODUCT, granularity, limit: String(limit) };
      if (startTime !== undefined) params.startTime = String(startTime);
      const data = (await get('/api/v2/mix/market/candles', params)) as string[][];
      const now = Date.now();
      const tf = TF_MS[granularity];
      return data
        .map((r) => ({
          ts: Number(r[0]),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
          quoteVolume: Number(r[6]),
        }))
        .sort((a, b) => a.ts - b.ts)
        .filter((c) => c.ts + tf <= now);
    },

    async contract(symbol) {
      const c = (await loadContracts()).get(symbol);
      if (!c) throw new BitgetError('NO_CONTRACT', `unknown contract ${symbol}`);
      return c;
    },
  };
}
