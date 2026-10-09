import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  localDate,
  localHour,
  monthOf,
  monthRange,
  weekdayIndex,
} from './time.js';

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

describe('localHour', () => {
  it('liefert die Stunde in der Zeitzone der Installation', () => {
    expect(localHour('2026-10-12T10:00:00Z', 'Europe/Berlin')).toBe(12);
    expect(localHour('2026-10-26T10:00:00Z', 'Europe/Berlin')).toBe(11);
    expect(localHour('2026-10-12T22:30:00Z', 'Europe/Berlin')).toBe(0);
  });
});

describe('Monate', () => {
  it('rechnet mit Monaten über Jahresgrenzen', () => {
    expect(monthOf('2026-10-12')).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthRange('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' });
  });

  it('bestimmt den Wochentag mit Montag als erstem Tag', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0);
    expect(weekdayIndex('2026-10-18')).toBe(6);
    expect(weekdayIndex('2026-10-01')).toBe(3);
  });
});
