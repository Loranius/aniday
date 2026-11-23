import type { MarketData } from './bitget';
import type { Reviewer, Review } from './claude';
import type { Notifier } from './telegram';
import { formatSignal } from './telegram';
import type { SignalsRepo, SettingsT, NewSignal } from './repo';
import type { Candidate, Candle, Mode, SignalGroup, Ticker } from './types';
import { SIGNALS_CONFIG } from './config';
import { canSpend, kyivDay, kyivDayStartMs } from './budget';
import { hotMovers, makeSnapshot, pumpPrefilter, topByVolume } from './universe';
import { detectIntraday } from './strategies/intraday';
import { detectPump } from './strategies/pump';
import { detectScalp } from './strategies/scalp';
import { sizePosition } from './sizing';
import { initialState } from './outcome';

export interface Deps {
  market: MarketData;
  repo: SignalsRepo;
  reviewer: Reviewer;
  notifier: Notifier;
  now: () => number;
}

export interface ModeReport {
  mode: Mode;
  candidates: number;
  sent: number;
  shadow: number;
  skipped: number;
  errors: string[];
}
export type ScanReport = ModeReport[];

interface Found {
  candidate: Candidate;
  candles: Candle[]; // свічки робочого таймфрейму для Claude
  ticker?: Ticker;
}

const MIN = 60_000;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const riskOf = (s: SettingsT, mode: Mode) =>
  mode === 'scalp' ? s.riskScalp : mode === 'intraday' ? s.riskIntraday : s.riskPump;

// Стан одного запуску: налаштування, витрати та ліміт рецензій спільні для всіх режимів
class RunCtx {
  private settingsP?: Promise<SettingsT>;
  private spendP?: Promise<{ today: number; month: number }>;
  private spend = { today: 0, month: 0 };
  reviews = 0;
  scalpSent: number | null = null;
  constructor(readonly deps: Deps) {}

  settings(): Promise<SettingsT> {
    return (this.settingsP ??= this.deps.repo.getSettings());
  }
  async loadSpend(): Promise<void> {
    this.spendP ??= (async () => {
      const now = this.deps.now();
      const [today, month] = await Promise.all([
        this.deps.repo.spendSince(kyivDay(now)),
        this.deps.repo.spendSince(`${kyivDay(now).slice(0, 7)}-01`),
      ]);
      this.spend = { today, month };
      return this.spend;
    })();
    await this.spendP;
  }
  canSpendNow(): boolean {
    return canSpend(this.spend.today, this.spend.month);
  }
  // резервуємо запас на час виклику, потім замінюємо його фактичною вартістю
  reserve(): number {
    const r = SIGNALS_CONFIG.budget.reserveUsd;
    this.spend.today += r;
    this.spend.month += r;
    return r;
  }
  settle(reserved: number, cost: number): void {
    this.spend.today += cost - reserved;
    this.spend.month += cost - reserved;
  }
}

// Перераховує стоп/тейки за коригуванням Claude, зберігаючи R-структуру режиму
function applyReview(c: Candidate, review: Review): Candidate {
  if (review.decision !== 'confirm' || (review.stop === undefined && review.tp1 === undefined)) return c;
  const tpR = SIGNALS_CONFIG.modes[c.mode].tpR;
  const mid = (c.entryLow + c.entryHigh) / 2;
  const sign = c.direction === 'long' ? 1 : -1;
  if (review.stop === undefined) return { ...c, tp1: review.tp1 as number };
  const R = Math.abs(mid - review.stop);
  return {
    ...c,
    stop: review.stop,
    tp1: review.tp1 ?? mid + sign * tpR[0] * R,
    tp2: tpR.length > 1 ? mid + sign * tpR[1] * R : null,
  };
}

async function processMode(mode: Mode, found: Found[], ctx: RunCtx, report: ModeReport): Promise<void> {
  const { repo, reviewer, notifier, market, now } = ctx.deps;
  report.candidates = found.length;
  if (found.length === 0) return;

  const settings = await ctx.settings();
  if (settings.paused.includes(mode)) {
    report.skipped += found.length;
    return;
  }

  // 1) відсів: активні дублі та скальп-ліміт
  const eligible: Found[] = [];
  for (const f of found) {
    try {
      if (await repo.hasActive(f.candidate.symbol, f.candidate.direction)) { report.skipped++; continue; }
      if (mode === 'scalp') {
        ctx.scalpSent ??= await repo.countSentToday('scalp', kyivDayStartMs(now()));
        if (ctx.scalpSent >= settings.scalpDailyLimit) { report.skipped++; continue; }
      }
      eligible.push(f);
    } catch (e) {
      report.errors.push(`${f.candidate.symbol}: ${errMsg(e)}`);
    }
  }
  if (eligible.length === 0) return;

  // 2) рецензії паралельно, у межах бюджету та maxReviewsPerRun
  type Outcome = { f: Found; group: SignalGroup; review: Review | null };
  await ctx.loadSpend().catch((e) => { report.errors.push(`budget: ${errMsg(e)}`); });
  const jobs: Promise<Outcome | null>[] = [];
  for (const f of eligible) {
    if (!ctx.canSpendNow()) {
      jobs.push(Promise.resolve({ f, group: 'no_claude', review: null }));
      continue;
    }
    if (ctx.reviews >= SIGNALS_CONFIG.maxReviewsPerRun) { report.skipped++; continue; }
    ctx.reviews++;
    const reserved = ctx.reserve();
    jobs.push(
      (async (): Promise<Outcome | null> => {
        try {
          const { review, costUsd } = await reviewer.review(f.candidate, { candles: f.candles, ticker: f.ticker });
          ctx.settle(reserved, costUsd);
          if (costUsd > 0) await repo.addSpend(kyivDay(now()), costUsd);
          const group: SignalGroup =
            review.decision === 'confirm' ? 'confirmed' : review.decision === 'reject' ? 'shadow' : 'no_claude';
          return { f, group, review };
        } catch (e) {
          ctx.settle(reserved, 0);
          report.errors.push(`${f.candidate.symbol}: ${errMsg(e)}`);
          return null;
        }
      })(),
    );
  }
  const outcomes = (await Promise.all(jobs)).filter((o): o is Outcome => o !== null);

  // 3) розмір, збереження, сповіщення
  for (const { f, group, review } of outcomes) {
    const symbol = f.candidate.symbol;
    try {
      const c = review ? applyReview(f.candidate, review) : f.candidate;
      const contract = await market.contract(symbol);
      const entry = (c.entryLow + c.entryHigh) / 2;
      const riskPct = riskOf(settings, mode);
      const sizing = sizePosition({
        direction: c.direction, entry, stop: c.stop, depositUsd: settings.depositUsd, riskPct, contract,
      });
      const createdAt = now();
      const claudeReason = review && review.decision !== 'unavailable' ? review.reason : null;
      const state = initialState(c, mode, createdAt);
      const row: NewSignal = {
        ...state,
        dedupeKey: `${mode}:${symbol}:${c.direction}:${c.candleTs}`,
        mode, group, symbol, timeframe: c.timeframe, pattern: c.pattern, metrics: c.metrics, sizing, claudeReason,
      };
      const ins = await repo.insertSignal(row);
      if (!ins) { report.skipped++; continue; }
      if (group === 'shadow') { report.shadow++; continue; }
      report.sent++;
      if (mode === 'scalp') ctx.scalpSent = (ctx.scalpSent ?? 0) + 1;
      const text = formatSignal(c, sizing, group, claudeReason, state.entryDeadline, contract.pricePlace, riskPct);
      const msgId = await notifier.send(text);
      if (msgId !== null) await repo.setMessageId(ins.id, msgId);
    } catch (e) {
      report.errors.push(`${symbol}: ${errMsg(e)}`);
    }
  }
}

// Виконує detect для кожного символу; помилки по символу збираються окремо
async function detectAll(
  symbols: string[],
  fn: (symbol: string) => Promise<Found | null>,
  report: ModeReport,
): Promise<Found[]> {
  const res = await Promise.all(
    symbols.map(async (s) => {
      try { return await fn(s); } catch (e) { report.errors.push(`${s}: ${errMsg(e)}`); return null; }
    }),
  );
  return res.filter((x): x is Found => x !== null);
}

const emptyReport = (mode: Mode): ModeReport => ({ mode, candidates: 0, sent: 0, shadow: 0, skipped: 0, errors: [] });

async function runSwing(ctx: RunCtx): Promise<ScanReport> {
  const { market, repo, now } = ctx.deps;
  const t = now();
  const tickers = await market.tickers();
  const snapshot = makeSnapshot(tickers, t);
  await repo.saveSnapshot(snapshot);
  const snaps = await repo.recentSnapshots(t - SIGNALS_CONFIG.scan.snapshotWindowMin * MIN);
  const top = topByVolume(tickers, SIGNALS_CONFIG.universe.topN);
  const pre = pumpPrefilter(tickers, new Set(top), snaps, t);
  const settings = await ctx.settings();
  const cc = SIGNALS_CONFIG.scan.candles;
  const reports: ScanReport = [];

  if (!settings.paused.includes('intraday')) {
    const rep = emptyReport('intraday');
    const found = await detectAll(top, async (symbol) => {
      const [c15, c1h] = await Promise.all([
        market.candles(symbol, '15m', cc.intraday15m),
        market.candles(symbol, '1H', cc.intraday1h),
      ]);
      const c = detectIntraday(symbol, c15, c1h);
      return c ? { candidate: c, candles: c15, ticker: tickers.find((x) => x.symbol === symbol) } : null;
    }, rep);
    await processMode('intraday', found, ctx, rep);
    reports.push(rep);
  }

  if (!settings.paused.includes('pump')) {
    const rep = emptyReport('pump');
    const found = await detectAll(pre.map((p) => p.symbol), async (symbol) => {
      const ticker = tickers.find((x) => x.symbol === symbol);
      const p = pre.find((x) => x.symbol === symbol);
      if (!ticker || !p) return null;
      const c15 = await market.candles(symbol, '15m', cc.pump15m);
      const c = detectPump(symbol, c15, ticker, p);
      return c ? { candidate: c, candles: c15, ticker } : null;
    }, rep);
    await processMode('pump', found, ctx, rep);
    reports.push(rep);
  }
  return reports;
}

async function runScalp(ctx: RunCtx): Promise<ScanReport> {
  const { market } = ctx.deps;
  const tickers = await market.tickers();
  const top = topByVolume(tickers, SIGNALS_CONFIG.universe.topN);
  const universe = [...new Set([...top, ...hotMovers(tickers, new Set(top))])];
  const cc = SIGNALS_CONFIG.scan.candles;
  const rep = emptyReport('scalp');
  const found = await detectAll(universe, async (symbol) => {
    const [c5, c1] = await Promise.all([market.candles(symbol, '5m', cc.scalp5m), market.candles(symbol, '1m', cc.scalp1m)]);
    const c = detectScalp(symbol, c5, c1);
    return c ? { candidate: c, candles: c5, ticker: tickers.find((x) => x.symbol === symbol) } : null;
  }, rep);
  // налаштування й БД читаються лише коли є кандидати
  await processMode('scalp', found, ctx, rep);
  return [rep];
}

export async function runScan(job: 'scalp' | 'swing', deps: Deps): Promise<ScanReport> {
  const ctx = new RunCtx(deps);
  return job === 'scalp' ? runScalp(ctx) : runSwing(ctx);
}
