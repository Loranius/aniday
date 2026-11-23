import type { SignalsRepo, SettingsT } from './repo';
import type { Notifier } from './telegram';
import { formatStats, escapeHtml } from './telegram';
import { computeStats } from './stats';
import { kyivDay } from './budget';
import { SIGNALS_CONFIG } from './config';
import type { Mode } from './types';

export interface CommandDeps {
  repo: SignalsRepo;
  notifier: Notifier;
  ownerId: string;
  now: () => number;
}

const MODES: Mode[] = ['scalp', 'intraday', 'pump'];
const DAY = 86_400_000;
const RISK_KEY: Record<Mode, keyof SettingsT> = { scalp: 'riskScalp', intraday: 'riskIntraday', pump: 'riskPump' };

const HELP = [
  '<b>Команди</b>',
  '/stats [7d|30d|all] — статистика (за замовч. 30d)',
  '/open — відкриті сигнали',
  '/risk &lt;scalp|intraday|pump|all&gt; &lt;%&gt; — ризик на угоду',
  '/deposit &lt;usd&gt; — депозит',
  '/pause [режим|all] — призупинити',
  '/resume [режим|all] — відновити',
  '/limit &lt;n&gt; — денний ліміт скальпу',
].join('\n');

const parseNum = (s: string | undefined): number | null =>
  s !== undefined && /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : null;

function parseModes(arg: string | undefined): Mode[] | null {
  if (arg === undefined || arg === 'all') return MODES;
  return (MODES as string[]).includes(arg) ? [arg as Mode] : null;
}

export async function handleUpdate(update: unknown, deps: CommandDeps): Promise<void> {
  const msg = (update as { message?: { text?: unknown; from?: { id?: unknown } } } | null)?.message;
  if (!msg || typeof msg.text !== 'string') return;
  if (String(msg.from?.id) !== deps.ownerId) return;

  const { repo, notifier, now } = deps;
  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, '');
  const reply = (t: string) => notifier.send(t);
  const B = SIGNALS_CONFIG.commandBounds;

  switch (cmd) {
    case '/start':
    case '/help':
      await reply(HELP);
      return;

    case '/stats': {
      const period = args[0] ?? '30d';
      if (!['7d', '30d', 'all'].includes(period)) {
        await reply('Використання: /stats [7d|30d|all]');
        return;
      }
      const t = now();
      const sinceMs = period === 'all' ? null : t - (period === '7d' ? 7 : 30) * DAY;
      const monthStart = `${kyivDay(t).slice(0, 7)}-01`;
      const [rows, spend] = await Promise.all([repo.statRows(sinceMs), repo.spendSince(monthStart)]);
      await reply(formatStats(computeStats(rows, sinceMs), spend));
      return;
    }

    case '/open': {
      const active = (await repo.listActive()).filter((s) => s.group !== 'shadow');
      if (!active.length) {
        await reply('Відкритих сигналів немає.');
        return;
      }
      await reply(
        active
          .map((s) => `${escapeHtml(s.symbol)} ${s.direction === 'long' ? 'LONG' : 'SHORT'} · ${s.mode} · ${s.status === 'pending' ? 'очікує входу' : 'відкрита'}`)
          .join('\n'),
      );
      return;
    }

    case '/risk': {
      const modes = parseModes(args[0]);
      const pct = parseNum(args[1]);
      if (!args[0] || !modes || pct === null || pct < B.riskMinPct || pct > B.riskMaxPct) {
        await reply(`Використання: /risk &lt;scalp|intraday|pump|all&gt; &lt;${B.riskMinPct}–${B.riskMaxPct}&gt;`);
        return;
      }
      const patch: Partial<SettingsT> = {};
      for (const m of modes) (patch as Record<string, number>)[RISK_KEY[m]] = pct;
      await repo.updateSettings(patch);
      let text = `Ризик ${args[0]}: ${pct}%`;
      if (pct > SIGNALS_CONFIG.sizing.highRiskWarnPct) text += `\n⚠️ Ризик вище ${SIGNALS_CONFIG.sizing.highRiskWarnPct}% на угоду — це дуже багато.`;
      await reply(text);
      return;
    }

    case '/deposit': {
      const usd = parseNum(args[0]);
      if (usd === null || usd <= B.depositMinUsd) {
        await reply('Використання: /deposit &lt;сума в USD, більше 0&gt;');
        return;
      }
      await repo.updateSettings({ depositUsd: usd });
      await reply(`Депозит: $${usd}`);
      return;
    }

    case '/pause':
    case '/resume': {
      const modes = parseModes(args[0]);
      if (!modes) {
        await reply(`Використання: ${cmd} [scalp|intraday|pump|all]`);
        return;
      }
      const cur = (await repo.getSettings()).paused;
      const paused =
        cmd === '/pause'
          ? MODES.filter((m) => cur.includes(m) || modes.includes(m))
          : cur.filter((m) => !modes.includes(m));
      await repo.updateSettings({ paused });
      await reply(paused.length ? `На паузі: ${paused.join(', ')}` : 'Усі режими активні.');
      return;
    }

    case '/limit': {
      const n = parseNum(args[0]);
      if (n === null || !Number.isInteger(n) || n < B.scalpLimitMin || n > B.scalpLimitMax) {
        await reply(`Використання: /limit &lt;ціле ${B.scalpLimitMin}–${B.scalpLimitMax}&gt;`);
        return;
      }
      await repo.updateSettings({ scalpDailyLimit: n });
      await reply(`Денний ліміт скальпу: ${n}`);
      return;
    }

    default:
      await reply('Невідома команда. /help — список команд.');
  }
}
