import type { CourseRule } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import { formatOccupancy, isFull, reportLines, ruleSummary } from './format.js';

const RULE: CourseRule = {
  id: '66f1a2b3c4d5e6f708192c01',
  serviceId: '66f1a2b3c4d5e6f708192a01',
  weekdays: [3, 1],
  startTime: '18:00',
  validFrom: '2026-11-02',
  validUntil: null,
  capacity: null,
  location: null,
};

describe('Kurs-Formatierung', () => {
  it('zeigt Belegung und ausgebuchte Termine', () => {
    expect(formatOccupancy({ bookedCount: 7, capacity: 12 })).toBe('7 / 12 Plätze');
    expect(isFull({ bookedCount: 12, capacity: 12 })).toBe(true);
    expect(isFull({ bookedCount: 11, capacity: 12 })).toBe(false);
  });

  it('fasst Regeln zusammen', () => {
    expect(ruleSummary(RULE)).toBe('Mo, Mi · 18:00 Uhr · ab Mo., 02.11.2026, unbefristet');
    expect(ruleSummary({ ...RULE, weekdays: [6], validUntil: '2026-12-19' })).toBe(
      'Sa · 18:00 Uhr · ab Mo., 02.11.2026 bis Sa., 19.12.2026',
    );
  });

  it('übersetzt den Erzeugungsbericht', () => {
    expect(
      reportLines({
        created: 1,
        conflicts: ['2026-11-04T18:00'],
        keptWithBookings: ['2026-11-09T18:00'],
      }),
    ).toEqual({
      summary: '1 Kurstermin erzeugt.',
      conflicts: ['Mi., 04.11.2026, 18:00 Uhr'],
      kept: ['Mo., 09.11.2026, 18:00 Uhr'],
    });
    expect(reportLines({ created: 8, conflicts: [], keptWithBookings: [] }).summary).toBe(
      '8 Kurstermine erzeugt.',
    );
  });
});
