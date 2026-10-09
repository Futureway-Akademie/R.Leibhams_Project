import { describe, expect, it } from 'vitest';
import { copyDay, validateWeek, weekSignature, weekToInput } from './opening-hours-form.js';
import type { WeekInput } from './opening-hours-form.js';

function week(): WeekInput {
  return weekToInput([
    {
      weekday: 1,
      windows: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    },
    { weekday: 5, windows: [{ start: '18:00', end: '24:00' }] },
  ]);
}

describe('Wochenplan', () => {
  it('übernimmt gespeicherte Tage; 24:00 wird zu „bis Mitternacht“', () => {
    const input = week();
    expect(input[1].open).toBe(true);
    expect(input[2]).toEqual({ open: false, windows: [] });
    expect(input[5].windows).toEqual([{ start: '18:00', end: '', untilMidnight: true }]);
  });

  it('erzeugt den Wochenplan sortiert und nur mit geöffneten Tagen', () => {
    const input = week();
    input[1].windows.reverse();
    input[3] = { open: false, windows: [{ start: '08:00', end: '10:00', untilMidnight: false }] };
    expect(validateWeek(input)).toEqual({
      ok: true,
      days: [
        {
          weekday: 1,
          windows: [
            { start: '09:00', end: '12:00' },
            { start: '13:00', end: '18:00' },
          ],
        },
        { weekday: 5, windows: [{ start: '18:00', end: '24:00' }] },
      ],
    });
  });

  it('meldet fehlende, ungültige und verdrehte Zeiten am Zeitfenster', () => {
    const input = week();
    input[1].windows = [
      { start: '', end: '12:00', untilMidnight: false },
      { start: '13:07', end: '18:00', untilMidnight: false },
      { start: '17:00', end: '16:00', untilMidnight: false },
    ];
    const result = validateWeek(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      '1.0.start': 'Bitte einen Beginn eingeben.',
      '1.1.start': 'Nur 5-Minuten-Schritte (z. B. 09:05).',
      '1.2.end': 'Das Ende muss nach dem Beginn liegen.',
    });
    expect(result.firstError).toBe('1.0.start');
  });

  it('meldet Überschneidungen und Tage ohne Zeitfenster', () => {
    const input = week();
    input[1].windows[1] = { start: '11:30', end: '18:00', untilMidnight: false };
    input[2] = { open: true, windows: [] };
    input[5].windows.push({ start: '20:00', end: '22:00', untilMidnight: false });
    const result = validateWeek(input);
    expect(result.ok ? null : result.errors).toEqual({
      '1.day': 'Die Zeitfenster dieses Tages überschneiden sich.',
      '2.day': 'Bitte mindestens ein Zeitfenster angeben oder den Tag schließen.',
      '5.day': 'Die Zeitfenster dieses Tages überschneiden sich.',
    });
  });

  it('erlaubt aneinandergrenzende Zeitfenster', () => {
    const input = week();
    input[1].windows[1] = { start: '12:00', end: '18:00', untilMidnight: false };
    expect(validateWeek(input).ok).toBe(true);
  });

  it('überträgt einen Tag als Kopie auf andere Tage', () => {
    const input = week();
    const copied = copyDay(input, 1, [2, 3, 1]);
    expect(copied[2]).toEqual(input[1]);
    expect(copied[3]).toEqual(input[1]);
    expect(copied[2].windows).not.toBe(input[1].windows);
    copied[2].windows[0] = { start: '10:00', end: '11:00', untilMidnight: false };
    expect(input[1].windows[0]?.start).toBe('09:00');
    expect(copyDay(input, 2, [1])[1]).toEqual({ open: false, windows: [] });
  });

  it('erkennt Änderungen unabhängig von Zeitfenstern geschlossener Tage', () => {
    const input = week();
    const closed = {
      ...input,
      3: { open: false, windows: [{ start: '08:00', end: '09:00', untilMidnight: false }] },
    };
    expect(weekSignature(closed)).toBe(weekSignature(input));
    expect(weekSignature({ ...input, 1: { ...input[1], open: false } })).not.toBe(
      weekSignature(input),
    );
  });
});
