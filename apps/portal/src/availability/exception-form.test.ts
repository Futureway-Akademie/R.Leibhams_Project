import { describe, expect, it } from 'vitest';
import { emptyException, validateException } from './exception-form.js';
import type { ExceptionInput } from './exception-form.js';

const base = (patch: Partial<ExceptionInput> = {}): ExceptionInput => ({
  ...emptyException('2026-12-21'),
  ...patch,
});

describe('Ausnahmen', () => {
  it('legt ganztägige Sperrzeiten bis einschließlich zum Enddatum an', () => {
    expect(validateException(base({ endDate: '2026-12-24', note: '  Urlaub ' }))).toEqual({
      ok: true,
      data: {
        kind: 'closed',
        start: '2026-12-21T00:00',
        end: '2026-12-25T00:00',
        note: 'Urlaub',
      },
    });
  });

  it('legt Zeiträume mit Uhrzeit an', () => {
    const result = validateException(
      base({ kind: 'extra_opening', allDay: false, startTime: '10:00', endTime: '14:30' }),
    );
    expect(result.ok && result.data).toEqual({
      kind: 'extra_opening',
      start: '2026-12-21T10:00',
      end: '2026-12-21T14:30',
      note: null,
    });
  });

  it('meldet ein Ende vor dem Beginn', () => {
    expect(validateException(base({ endDate: '2026-12-20' }))).toMatchObject({
      ok: false,
      errors: { endDate: 'Das Ende darf nicht vor dem Beginn liegen.' },
    });
    expect(
      validateException(base({ allDay: false, startTime: '12:00', endTime: '12:00' })),
    ).toMatchObject({ ok: false, errors: { endTime: 'Das Ende muss nach dem Beginn liegen.' } });
  });

  it('meldet fehlende Daten, Uhrzeiten außerhalb des Rasters und zu lange Notizen', () => {
    const result = validateException(
      base({
        allDay: false,
        startDate: '',
        startTime: '09:03',
        endTime: '',
        note: 'x'.repeat(201),
      }),
    );
    expect(result).toEqual({
      ok: false,
      firstError: 'startDate',
      errors: {
        startDate: 'Bitte ein Datum eingeben.',
        startTime: 'Nur 5-Minuten-Schritte (z. B. 09:05).',
        endTime: 'Bitte eine Uhrzeit eingeben.',
        note: 'Die Notiz darf höchstens 200 Zeichen lang sein.',
      },
    });
  });

  it('ignoriert Uhrzeiten bei ganztägigen Ausnahmen', () => {
    expect(validateException(base({ startTime: '', endTime: '' })).ok).toBe(true);
  });
});
