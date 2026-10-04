import { describe, expect, it } from 'vitest';
import { normalizeVin, parseNumber, validateOdometer, validateVin, vinHint } from '../validation';

describe('validation', () => {
  it('normalizes and validates VIN', () => {
    expect(normalizeVin(' jn1bc11e 08u000001 ')).toBe('JN1BC11E08U000001');
    expect(validateVin('JN1BC11E08U000001')).toBeNull();
    expect(validateVin('NT31-123456')).toBeNull();
    expect(validateVin('ВІН123')).not.toBeNull();
    expect(vinHint('JN1BC11E08U000001')).toBeNull();
    expect(vinHint('JN1BC11E08U00000O')).not.toBeNull();
  });
  it('parses localized numbers and validates odometer', () => {
    expect(parseNumber('184 357,5')).toBe(184357.5);
    expect(Number.isNaN(parseNumber(''))).toBe(true);
    expect(validateOdometer(-1)).not.toBeNull();
    expect(validateOdometer(184000)).toBeNull();
  });
});
