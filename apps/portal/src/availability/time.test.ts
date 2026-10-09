import { describe, expect, it } from 'vitest';
import { addDays, formatLocalRange, isDate, isOnGrid, isTime, todayIn } from './time.js';

describe('lokale Zeiten', () => {
  it('erkennt gültige Uhrzeiten, Daten und das 5-Minuten-Raster', () => {
    expect(isTime('09:05')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('9:05')).toBe(false);
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('')).toBe(false);
    expect(isOnGrid('09:05')).toBe(true);
    expect(isOnGrid('09:07')).toBe(false);
  });

  it('addiert Tage über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('liefert das heutige Datum in der Zeitzone der Installation', () => {
    const now = new Date('2026-10-11T22:30:00Z');
    expect(todayIn('Europe/Berlin', now)).toBe('2026-10-12');
    expect(todayIn('America/New_York', now)).toBe('2026-10-11');
  });

  it.each([
    ['2026-12-21T00:00', '2026-12-25T00:00', 'Mo., 21.12.2026 – Do., 24.12.2026, ganztägig'],
    ['2026-12-21T00:00', '2026-12-22T00:00', 'Mo., 21.12.2026, ganztägig'],
    ['2026-12-21T09:00', '2026-12-21T12:30', 'Mo., 21.12.2026, 09:00–12:30 Uhr'],
    ['2026-12-21T18:00', '2026-12-22T00:00', 'Mo., 21.12.2026, 18:00–24:00 Uhr'],
    [
      '2026-12-21T18:00',
      '2026-12-22T08:00',
      'Mo., 21.12.2026, 18:00 Uhr – Di., 22.12.2026, 08:00 Uhr',
    ],
  ])('formatiert %s bis %s', (start, end, text) => {
    expect(formatLocalRange(start, end)).toBe(text);
  });
});
