/** Client-side validation mirroring the database CHECK constraints (so queued writes don't get rejected later). */

export const normalizeVin = (v: string) => v.toUpperCase().replace(/\s+/g, '');
export const normalizePlate = (v: string) => v.toUpperCase().replace(/\s+/g, ' ').trim();

export function validateVin(vin: string): string | null {
  if (!vin) return null;
  if (!/^[A-Z0-9-]{5,20}$/.test(vin)) return 'Лише латинські літери, цифри та дефіс (5–20 символів)';
  return null;
}

/** Non-blocking hint: a standard VIN has 17 characters without I, O, Q. */
export function vinHint(vin: string): string | null {
  if (!vin) return null;
  if (vin.length === 17 && /[IOQ]/.test(vin)) return 'Стандартний VIN не містить літер I, O, Q — перевірте';
  if (vin.length !== 17) return 'Стандартний VIN має 17 символів (для японських авто може бути номер кузова)';
  return null;
}

export function validateOdometer(v: number): string | null {
  if (!Number.isFinite(v)) return 'Вкажіть число';
  if (v < 0) return 'Пробіг не може бути відʼємним';
  if (v >= 10_000_000) return 'Занадто велике значення';
  return null;
}

export function parseNumber(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(',', '.');
  return cleaned === '' ? NaN : Number(cleaned);
}
