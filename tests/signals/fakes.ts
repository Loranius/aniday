import type { SignalsRepo, SignalRow, SettingsT, NewSignal } from '../../lib/signals/repo';
import type { MarketData, ContractInfo, Granularity } from '../../lib/signals/bitget';
import type { Reviewer, Review } from '../../lib/signals/claude';
import type { Notifier } from '../../lib/signals/telegram';
import type { Snapshot } from '../../lib/signals/universe';
import type { TrackState } from '../../lib/signals/outcome';
import type { Candle, Ticker, Candidate } from '../../lib/signals/types';

export interface StoredSignal extends NewSignal {
  id: string;
  telegramMessageId: number | null;
}

// In-memory SignalsRepo; calls[] рахує кожне звернення до репозиторію
export class FakeRepo implements SignalsRepo {
  settings: SettingsT = {
    depositUsd: 500, riskScalp: 1, riskIntraday: 2, riskPump: 1, paused: [], scalpDailyLimit: 10,
  };
  signals: StoredSignal[] = [];
  spend: Record<string, number> = {};
  snapshots: Snapshot[] = [];
  calls: string[] = [];
  spendOverride: number | null = null; // spendSince завжди повертає це значення
  private seq = 0;

  async getSettings() { this.calls.push('getSettings'); return { ...this.settings }; }
  async updateSettings(p: Partial<SettingsT>) { this.calls.push('updateSettings'); Object.assign(this.settings, p); return { ...this.settings }; }
  async insertSignal(s: NewSignal) {
    this.calls.push('insertSignal');
    if (this.signals.some((x) => x.dedupeKey === s.dedupeKey)) return null;
    const id = `sig${++this.seq}`;
    this.signals.push({ ...s, id, telegramMessageId: null });
    return { id };
  }
  async existsByDedupeKey(key: string) { this.calls.push('existsByDedupeKey'); return this.signals.some((x) => x.dedupeKey === key); }
  async hasActive(symbol: string, direction: 'long' | 'short') {
    this.calls.push('hasActive');
    return this.signals.some(
      (x) => x.symbol === symbol && x.direction === direction && x.group !== 'shadow' &&
        (x.status === 'pending' || x.status === 'open'),
    );
  }
  async countSentToday(mode: string, dayStartMs: number) {
    this.calls.push('countSentToday');
    return this.signals.filter((x) => x.mode === mode && x.group !== 'shadow' && x.createdAt >= dayStartMs).length;
  }
  async listActive(): Promise<SignalRow[]> {
    this.calls.push('listActive');
    return this.signals
      .filter((x) => x.status === 'pending' || x.status === 'open')
      .map((x) => ({ ...x, metrics: x.metrics }));
  }
  async saveTrackState(id: string, st: TrackState) {
    this.calls.push('saveTrackState');
    const s = this.signals.find((x) => x.id === id)!;
    Object.assign(s, st);
  }
  async setMessageId(id: string, msgId: number) {
    this.calls.push('setMessageId');
    this.signals.find((x) => x.id === id)!.telegramMessageId = msgId;
  }
  async statRows() { this.calls.push('statRows'); return []; }
  async addSpend(day: string, cost: number) { this.calls.push('addSpend'); this.spend[day] = (this.spend[day] ?? 0) + cost; }
  async spendSince(dayFrom: string) {
    this.calls.push('spendSince');
    if (this.spendOverride !== null) return this.spendOverride;
    return Object.entries(this.spend).filter(([d]) => d >= dayFrom).reduce((a, [, v]) => a + v, 0);
  }
  async saveSnapshot(s: Snapshot) { this.calls.push('saveSnapshot'); this.snapshots.push(s); }
  async recentSnapshots(sinceMs: number) { this.calls.push('recentSnapshots'); return this.snapshots.filter((s) => s.ts >= sinceMs); }
}

export class FakeMarket implements MarketData {
  tickerList: Ticker[] = [];
  data: Record<string, Partial<Record<Granularity, Candle[]>>> = {};
  failFor = new Set<string>();
  calls: { symbol: string; g: Granularity; limit: number; startTime?: number }[] = [];
  tickerCalls = 0;
  // як справжній Bitget: з `limit` свічок остання формується й відкидається → limit−1 закритих
  honourLimit = false;
  async tickers() { this.tickerCalls++; return this.tickerList; }
  async candles(symbol: string, g: Granularity, limit: number, startTime?: number) {
    this.calls.push({ symbol, g, limit, startTime });
    if (this.failFor.has(symbol)) throw new Error('boom');
    let c = this.data[symbol]?.[g] ?? [];
    if (startTime !== undefined) c = c.filter((k) => k.ts >= startTime);
    return c.slice(-(this.honourLimit ? limit - 1 : limit));
  }
  async contract(symbol: string): Promise<ContractInfo> {
    return { symbol, pricePlace: 2, volumePlace: 1, minTradeNum: 0.1, maxLeverage: 50 };
  }
}

export class FakeReviewer implements Reviewer {
  calls: Candidate[] = [];
  constructor(public review_: Review = { decision: 'confirm', reason: 'ок' }, public cost = 0.01) {}
  async review(c: Candidate) {
    this.calls.push(c);
    return { review: this.review_, costUsd: this.cost };
  }
}

export class FakeNotifier implements Notifier {
  sent: { text: string; replyTo?: number }[] = [];
  nextId = 100;
  async send(text: string, replyTo?: number) {
    this.sent.push({ text, replyTo });
    return this.nextId++;
  }
}
