import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUpdate } from '../../lib/signals/commands';
import type { SettingsT } from '../../lib/signals/repo';

const settings: SettingsT = { depositUsd: 500, riskScalp: 1, riskIntraday: 2, riskPump: 1, paused: [], scalpDailyLimit: 10 };
const NOW = Date.UTC(2026, 10, 23, 12, 0);

let repo: any, notifier: any;
beforeEach(() => {
  repo = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn(async (p) => ({ ...settings, ...p })),
    listActive: vi.fn().mockResolvedValue([
      { symbol: 'SOLUSDT', direction: 'long', mode: 'scalp', status: 'open', group: 'confirmed' },
      { symbol: 'XUSDT', direction: 'short', mode: 'scalp', status: 'open', group: 'shadow' },
    ]),
    statRows: vi.fn().mockResolvedValue([]),
    spendSince: vi.fn().mockResolvedValue(1.5),
  };
  notifier = { send: vi.fn().mockResolvedValue(1) };
});
const upd = (text: string, id = 100) => ({ message: { text, from: { id }, chat: { id } } });
const run = (text: string, id = 100) => handleUpdate(upd(text, id), { repo, notifier, ownerId: '100', now: () => NOW });
const reply = () => notifier.send.mock.calls[0][0] as string;

describe('handleUpdate', () => {
  it('ігнорує чужого', async () => {
    await run('/risk all 3', 999);
    expect(notifier.send).not.toHaveBeenCalled();
    expect(repo.updateSettings).not.toHaveBeenCalled();
    expect(repo.getSettings).not.toHaveBeenCalled();
  });
  it('ігнорує не-повідомлення', async () => {
    await handleUpdate({ edited_message: {} }, { repo, notifier, ownerId: '100', now: () => NOW });
    await handleUpdate(null, { repo, notifier, ownerId: '100', now: () => NOW });
    expect(notifier.send).not.toHaveBeenCalled();
  });
  it('/risk intraday 3', async () => {
    await run('/risk intraday 3');
    expect(repo.updateSettings).toHaveBeenCalledWith({ riskIntraday: 3 });
  });
  it('/risk all 10 з попередженням', async () => {
    await run('/risk all 10');
    expect(repo.updateSettings).toHaveBeenCalledWith({ riskScalp: 10, riskIntraday: 10, riskPump: 10 });
    expect(reply()).toContain('⚠️');
  });
  it('/risk невалідне', async () => {
    for (const t of ['/risk foo', '/risk scalp 0', '/risk scalp 51', '/risk scalp x', '/risk scalp']) {
      notifier.send.mockClear();
      await run(t);
      expect(notifier.send).toHaveBeenCalledTimes(1);
    }
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });
  it('/deposit', async () => {
    await run('/deposit 1000');
    expect(repo.updateSettings).toHaveBeenCalledWith({ depositUsd: 1000 });
    await run('/deposit 0');
    await run('/deposit -5');
    expect(repo.updateSettings).toHaveBeenCalledTimes(1);
  });
  it('/pause і /resume', async () => {
    await run('/pause scalp');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ paused: ['scalp'] });
    await run('/pause all');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ paused: ['scalp', 'intraday', 'pump'] });
    repo.getSettings.mockResolvedValue({ ...settings, paused: ['scalp', 'pump'] });
    await run('/resume scalp');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ paused: ['pump'] });
    await run('/resume all');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ paused: [] });
  });
  it('/pause без аргументу = all', async () => {
    await run('/pause');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ paused: ['scalp', 'intraday', 'pump'] });
  });
  it('/limit', async () => {
    await run('/limit 5');
    expect(repo.updateSettings).toHaveBeenLastCalledWith({ scalpDailyLimit: 5 });
    await run('/limit 101');
    await run('/limit 2.5');
    expect(repo.updateSettings).toHaveBeenCalledTimes(1);
  });
  it('/stats періоди', async () => {
    await run('/stats');
    expect(repo.statRows).toHaveBeenLastCalledWith(NOW - 30 * 86_400_000);
    await run('/stats 7d');
    expect(repo.statRows).toHaveBeenLastCalledWith(NOW - 7 * 86_400_000);
    await run('/stats all');
    expect(repo.statRows).toHaveBeenLastCalledWith(null);
    expect(repo.spendSince).toHaveBeenLastCalledWith('2026-11-01');
  });
  it('/open без shadow', async () => {
    await run('/open');
    expect(reply()).toContain('SOLUSDT');
    expect(reply()).not.toContain('XUSDT');
  });
  it('/start, /help, невідома', async () => {
    await run('/start');
    expect(reply()).toContain('/stats');
    notifier.send.mockClear();
    await run('/foo');
    expect(notifier.send).toHaveBeenCalledTimes(1);
    notifier.send.mockClear();
    await run('/help@my_bot');
    expect(reply()).toContain('/risk');
  });
});
