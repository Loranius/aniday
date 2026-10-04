const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatInt = (n: number) => nf0.format(Math.round(n));
export const formatKm = (n: number, digits: 0 | 1 = 0) => `${digits ? nf1.format(n) : nf0.format(Math.round(n))} км`;
export const formatMoney = (n: number) => `${nf0.format(Math.round(n))} грн`;
export const formatMoney2 = (n: number) => `${nf2.format(n)} грн`;
export const formatNumber1 = (n: number) => nf1.format(n);

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return '<1 хв';
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  return `${h} год ${m % 60} хв`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

/** Accepts 'YYYY-MM-DD' (treated as a local calendar date) or an ISO timestamp. */
function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  }
  return new Date(v);
}

export const formatDate = (v: string | Date) => dateFmt.format(toDate(v));
export const formatShortDate = (v: string | Date) => shortDateFmt.format(toDate(v));
export const formatTime = (v: string | Date) => timeFmt.format(toDate(v));

export function formatDayHeading(v: string | Date, now = new Date()): string {
  const d = toDate(v);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'Сьогодні';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Вчора';
  const s = weekdayFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Орієнтовно через 4 міс." — explicitly a forecast. */
export function formatForecast(months: number): string {
  if (months < 0.5) return 'Орієнтовно найближчими тижнями';
  if (months < 1.5) return 'Орієнтовно через місяць';
  const m = Math.round(months);
  const word = m % 10 === 1 && m % 100 !== 11 ? 'місяць' : [2, 3, 4].includes(m % 10) && ![12, 13, 14].includes(m % 100) ? 'місяці' : 'місяців';
  return `Орієнтовно через ${m} ${word}`;
}

/** Ukrainian plural: plural(n, ['поїздка', 'поїздки', 'поїздок']). */
export function plural(n: number, forms: [string, string, string]): string {
  const w = n % 10 === 1 && n % 100 !== 11 ? forms[0] : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? forms[1] : forms[2];
  return `${n} ${w}`;
}

export const pluralTrips = (n: number) => plural(n, ['поїздка', 'поїздки', 'поїздок']);
