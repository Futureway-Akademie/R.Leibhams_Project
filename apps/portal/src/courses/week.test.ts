import { describe, expect, it } from 'vitest';
import {
  formatWeek,
  isoWeekNumber,
  startOfWeek,
  weekDates,
  weekFromParam,
  weekdayOf,
} from './week.js';

describe('Kalenderwochen', () => {
  it('bestimmt Wochentag und Montag der Woche', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-18')).toBe(7);
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(weekDates('2026-12-28').at(-1)).toBe('2027-01-03');
  });

  it('berechnet ISO-Kalenderwochen auch am Jahreswechsel', () => {
    expect(isoWeekNumber('2026-10-12')).toBe(42);
    expect(isoWeekNumber('2026-12-28')).toBe(53);
    expect(isoWeekNumber('2027-01-04')).toBe(1);
    expect(isoWeekNumber('2025-12-29')).toBe(1);
  });

  it('liest die Woche aus der Adresse oder nimmt die aktuelle', () => {
    expect(weekFromParam('2026-10-15', '2026-01-01')).toBe('2026-10-12');
    expect(weekFromParam('kaputt', '2026-10-09')).toBe('2026-10-05');
    expect(weekFromParam(null, '2026-10-09')).toBe('2026-10-05');
  });

  it('formatiert die Woche', () => {
    expect(formatWeek('2026-10-12')).toBe('KW 42 · 12.10.–18.10.2026');
  });
});
