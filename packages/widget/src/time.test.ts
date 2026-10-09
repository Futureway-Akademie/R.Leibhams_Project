import { describe, expect, it } from 'vitest';
import { addDays, localDate } from './time.js';

describe('localDate', () => {
  it('liefert das Datum in der Zeitzone der Installation', () => {
    expect(localDate('2026-10-11T22:30:00Z', 'Europe/Berlin')).toBe('2026-10-12');
    expect(localDate('2026-10-11T22:30:00Z', 'America/New_York')).toBe('2026-10-11');
    expect(localDate(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin')).toBe('2026-03-29');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-10-12', 61, '2026-12-12'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-03-29', 0, '2026-03-29'],
    ['2026-03-01', -1, '2026-02-28'],
  ])('%s + %i = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});
