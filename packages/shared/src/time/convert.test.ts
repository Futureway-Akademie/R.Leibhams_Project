import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  localBoundaryToUtc,
  addMinutesUtc,
  eachLocalDate,
  isoWeekdayOf,
  localDayRangeUtc,
  localToday,
  localToUtc,
  minutesBetweenUtc,
  utcToLocal,
} from './convert.js';

const BERLIN = 'Europe/Berlin';

describe('localToUtc – Europe/Berlin', () => {
  it('rechnet Winterzeit (UTC+1) um', () => {
    expect(localToUtc('2026-01-15T10:00', BERLIN)).toEqual({
      ok: true,
      utc: '2026-01-15T09:00:00Z',
    });
  });

  it('rechnet Sommerzeit (UTC+2) um', () => {
    expect(localToUtc('2026-07-15T10:00', BERLIN)).toEqual({
      ok: true,
      utc: '2026-07-15T08:00:00Z',
    });
  });

  describe('Sommerzeitbeginn 29.03.2026 (02:00 → 03:00)', () => {
    it('meldet 02:00 und 02:30 als übersprungen', () => {
      expect(localToUtc('2026-03-29T02:00', BERLIN)).toEqual({ ok: false, reason: 'skipped' });
      expect(localToUtc('2026-03-29T02:30', BERLIN)).toEqual({ ok: false, reason: 'skipped' });
    });
    it('rechnet die Zeiten direkt davor und danach korrekt um', () => {
      expect(localToUtc('2026-03-29T01:59', BERLIN)).toEqual({
        ok: true,
        utc: '2026-03-29T00:59:00Z',
      });
      expect(localToUtc('2026-03-29T03:00', BERLIN)).toEqual({
        ok: true,
        utc: '2026-03-29T01:00:00Z',
      });
    });
  });

  describe('Winterzeitbeginn 25.10.2026 (03:00 → 02:00)', () => {
    it('wählt bei doppelter Uhrzeit das erste Vorkommen', () => {
      expect(localToUtc('2026-10-25T02:30', BERLIN)).toEqual({
        ok: true,
        utc: '2026-10-25T00:30:00Z',
      });
      expect(localToUtc('2026-10-25T02:00', BERLIN)).toEqual({
        ok: true,
        utc: '2026-10-25T00:00:00Z',
      });
    });
    it('rechnet 03:00 bereits in Winterzeit um', () => {
      expect(localToUtc('2026-10-25T03:00', BERLIN)).toEqual({
        ok: true,
        utc: '2026-10-25T02:00:00Z',
      });
    });
  });

  it('lehnt ungültige Datumswerte ab', () => {
    expect(() => localToUtc('2026-02-30T10:00', BERLIN)).toThrow(RangeError);
  });
});

describe('localToUtc – America/New_York (Gegenprobe)', () => {
  it('behandelt die US-Umstellung am 08.03.2026', () => {
    expect(localToUtc('2026-03-08T02:30', 'America/New_York')).toEqual({
      ok: false,
      reason: 'skipped',
    });
    expect(localToUtc('2026-03-08T03:00', 'America/New_York')).toEqual({
      ok: true,
      utc: '2026-03-08T07:00:00Z',
    });
  });
  it('wählt am 01.11.2026 das erste Vorkommen', () => {
    expect(localToUtc('2026-11-01T01:30', 'America/New_York')).toEqual({
      ok: true,
      utc: '2026-11-01T05:30:00Z',
    });
  });
});

describe('utcToLocal', () => {
  it('zerlegt in lokale Angaben', () => {
    expect(utcToLocal('2026-10-08T08:00:00Z', BERLIN)).toEqual({
      date: '2026-10-08',
      time: '10:00',
      dateTime: '2026-10-08T10:00',
      weekday: 4,
    });
  });
  it('wechselt bei später UTC-Zeit auf den nächsten lokalen Tag', () => {
    expect(utcToLocal('2026-07-31T22:30:00Z', BERLIN)).toMatchObject({
      date: '2026-08-01',
      time: '00:30',
      weekday: 6,
    });
  });
  it('zeigt beide Vorkommen der doppelten Stunde als 02:30', () => {
    expect(utcToLocal('2026-10-25T00:30:00Z', BERLIN).time).toBe('02:30');
    expect(utcToLocal('2026-10-25T01:30:00Z', BERLIN).time).toBe('02:30');
  });
  it('ist die Umkehrung von localToUtc', () => {
    const result = localToUtc('2026-12-24T14:15', BERLIN);
    if (!result.ok) throw new Error('unerwartet übersprungen');
    expect(utcToLocal(result.utc, BERLIN).dateTime).toBe('2026-12-24T14:15');
  });
});

describe('localDayRangeUtc', () => {
  it('liefert einen normalen 24-Stunden-Tag', () => {
    const range = localDayRangeUtc('2026-06-01', BERLIN);
    expect(range).toEqual({ start: '2026-05-31T22:00:00Z', end: '2026-06-01T22:00:00Z' });
    expect(minutesBetweenUtc(range.start, range.end)).toBe(24 * 60);
  });
  it('liefert 23 Stunden am Sommerzeitbeginn', () => {
    const range = localDayRangeUtc('2026-03-29', BERLIN);
    expect(minutesBetweenUtc(range.start, range.end)).toBe(23 * 60);
  });
  it('liefert 25 Stunden am Winterzeitbeginn', () => {
    const range = localDayRangeUtc('2026-10-25', BERLIN);
    expect(minutesBetweenUtc(range.start, range.end)).toBe(25 * 60);
  });
});

describe('addMinutesUtc', () => {
  it('zählt echte Minuten über die Zeitumstellung hinweg', () => {
    // Kurs 01:30–03:30 lokal in der Nacht der Winterzeitumstellung: 120 echte Minuten,
    // endet aber lokal um 02:30 (zweites Vorkommen).
    const start = localToUtc('2026-10-25T01:30', BERLIN);
    if (!start.ok) throw new Error('unerwartet übersprungen');
    const end = addMinutesUtc(start.utc, 120);
    expect(end).toBe('2026-10-25T01:30:00Z');
    expect(utcToLocal(end, BERLIN).time).toBe('02:30');
  });
});

describe('Kalenderrechnung', () => {
  it('addiert lokale Tage über Monats- und Jahresgrenzen', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2026-10-07', 90)).toBe('2027-01-05');
  });
  it('bestimmt ISO-Wochentage', () => {
    expect(isoWeekdayOf('2026-10-05')).toBe(1);
    expect(isoWeekdayOf('2026-10-11')).toBe(7);
  });
  it('zählt Daten inklusive Ende auf', () => {
    expect(eachLocalDate('2026-03-28', '2026-03-30')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    expect(eachLocalDate('2026-03-30', '2026-03-28')).toEqual([]);
  });
  it('bestimmt das lokale Datum zu einem Zeitpunkt', () => {
    expect(localToday(BERLIN, '2026-10-07T22:30:00Z')).toBe('2026-10-08');
  });
});

describe('localBoundaryToUtc', () => {
  it('rechnet normale Grenzen wie localToUtc um', () => {
    expect(localBoundaryToUtc('2026-06-01T09:00', BERLIN)).toBe('2026-06-01T07:00:00Z');
  });
  it('verschiebt Grenzen in der übersprungenen Stunde auf den Umstellungszeitpunkt', () => {
    // 29.03.2026: 02:00 Winterzeit springt auf 03:00 Sommerzeit = 01:00Z.
    expect(localBoundaryToUtc('2026-03-29T02:00', BERLIN)).toBe('2026-03-29T01:00:00Z');
    expect(localBoundaryToUtc('2026-03-29T02:30', BERLIN)).toBe('2026-03-29T01:00:00Z');
  });
  it('wählt bei doppelter Uhrzeit das erste Vorkommen', () => {
    expect(localBoundaryToUtc('2026-10-25T02:30', BERLIN)).toBe('2026-10-25T00:30:00Z');
  });
});
