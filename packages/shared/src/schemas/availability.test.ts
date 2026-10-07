import { describe, expect, it } from 'vitest';
import { availabilityExceptionQuerySchema } from './availability.js';
import {
  availabilityExceptionCreateSchema,
  courseRuleCreateSchema,
  openingHoursUpdateSchema,
} from './owner-api.js';

const serviceId = '65f1a2b3c4d5e6f7a8b9c0d1';

describe('Öffnungszeiten', () => {
  it('akzeptiert mehrere Fenster pro Tag', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [
          {
            weekday: 1,
            windows: [
              { start: '09:00', end: '12:00' },
              { start: '13:00', end: '18:00' },
            ],
          },
          { weekday: 6, windows: [{ start: '09:00', end: '14:00' }] },
        ],
      }).success,
    ).toBe(true);
  });

  it('erlaubt direkt aneinandergrenzende Fenster', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [
          {
            weekday: 2,
            windows: [
              { start: '13:00', end: '18:00' },
              { start: '09:00', end: '13:00' },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('lehnt überlappende Fenster ab', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [
          {
            weekday: 1,
            windows: [
              { start: '09:00', end: '12:30' },
              { start: '12:00', end: '18:00' },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('lehnt Fenster mit Ende vor Beginn ab', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [{ weekday: 1, windows: [{ start: '18:00', end: '09:00' }] }],
      }).success,
    ).toBe(false);
  });

  it('lehnt doppelte Wochentage ab', () => {
    const day = { weekday: 3, windows: [{ start: '09:00', end: '12:00' }] };
    expect(openingHoursUpdateSchema.safeParse({ days: [day, day] }).success).toBe(false);
  });

  it('lehnt ungültige Wochentage ab', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [{ weekday: 0, windows: [{ start: '09:00', end: '12:00' }] }],
      }).success,
    ).toBe(false);
  });

  it('erlaubt Öffnung bis Mitternacht', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [{ weekday: 5, windows: [{ start: '18:00', end: '24:00' }] }],
      }).success,
    ).toBe(true);
  });
});

describe('Ausnahmen', () => {
  it('akzeptiert mehrtägigen Urlaub', () => {
    const result = availabilityExceptionCreateSchema.parse({
      kind: 'closed',
      start: '2026-12-24T00:00',
      end: '2027-01-02T00:00',
    });
    expect(result.note).toBeNull();
  });
  it('akzeptiert zusätzliche Öffnung', () => {
    expect(
      availabilityExceptionCreateSchema.safeParse({
        kind: 'extra_opening',
        start: '2026-11-01T10:00',
        end: '2026-11-01T14:00',
        note: 'Sonntagsöffnung',
      }).success,
    ).toBe(true);
  });
  it('lehnt Ende vor Beginn ab', () => {
    expect(
      availabilityExceptionCreateSchema.safeParse({
        kind: 'closed',
        start: '2026-12-24T12:00',
        end: '2026-12-24T10:00',
      }).success,
    ).toBe(false);
  });
  it('lehnt UTC-Zeitpunkte ab, weil Ausnahmen lokal gelten', () => {
    expect(
      availabilityExceptionCreateSchema.safeParse({
        kind: 'closed',
        start: '2026-12-24T10:00:00Z',
        end: '2026-12-24T12:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('Wiederkehrende Kursregeln', () => {
  it('akzeptiert eine wöchentliche Regel mit Standardwerten', () => {
    const result = courseRuleCreateSchema.parse({
      serviceId,
      weekdays: [1, 3],
      startTime: '18:30',
      validFrom: '2026-10-12',
    });
    expect(result).toMatchObject({ validUntil: null, capacity: null, location: null });
  });
  it('lehnt doppelte Wochentage ab', () => {
    expect(
      courseRuleCreateSchema.safeParse({
        serviceId,
        weekdays: [1, 1],
        startTime: '18:30',
        validFrom: '2026-10-12',
      }).success,
    ).toBe(false);
  });
  it('lehnt leere Wochentagsliste ab', () => {
    expect(
      courseRuleCreateSchema.safeParse({
        serviceId,
        weekdays: [],
        startTime: '18:30',
        validFrom: '2026-10-12',
      }).success,
    ).toBe(false);
  });
  it('lehnt Gültig-bis vor Gültig-ab ab', () => {
    expect(
      courseRuleCreateSchema.safeParse({
        serviceId,
        weekdays: [2],
        startTime: '18:30',
        validFrom: '2026-10-12',
        validUntil: '2026-10-01',
      }).success,
    ).toBe(false);
  });
  it('lehnt Kapazität unter 2 ab', () => {
    expect(
      courseRuleCreateSchema.safeParse({
        serviceId,
        weekdays: [2],
        startTime: '18:30',
        validFrom: '2026-10-12',
        capacity: 1,
      }).success,
    ).toBe(false);
  });
  it('lehnt 24:00 als Startzeit ab', () => {
    expect(
      courseRuleCreateSchema.safeParse({
        serviceId,
        weekdays: [2],
        startTime: '24:00',
        validFrom: '2026-10-12',
      }).success,
    ).toBe(false);
  });
});

describe('5-Minuten-Raster', () => {
  it('lehnt Öffnungszeiten außerhalb des Rasters ab', () => {
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [{ weekday: 1, windows: [{ start: '09:07', end: '12:00' }] }],
      }).success,
    ).toBe(false);
    expect(
      openingHoursUpdateSchema.safeParse({
        days: [{ weekday: 1, windows: [{ start: '09:05', end: '12:55' }] }],
      }).success,
    ).toBe(true);
  });
  it('lehnt Ausnahmen außerhalb des Rasters ab', () => {
    expect(
      availabilityExceptionCreateSchema.safeParse({
        kind: 'closed',
        start: '2026-12-24T10:02',
        end: '2026-12-24T12:00',
      }).success,
    ).toBe(false);
  });
});

describe('availabilityExceptionQuerySchema', () => {
  it('akzeptiert offene und geschlossene Zeiträume', () => {
    expect(availabilityExceptionQuerySchema.safeParse({}).success).toBe(true);
    expect(
      availabilityExceptionQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success,
    ).toBe(true);
  });
  it('lehnt umgekehrte Zeiträume ab', () => {
    expect(
      availabilityExceptionQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});
