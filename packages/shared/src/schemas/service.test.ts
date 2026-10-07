import { describe, expect, it } from 'vitest';
import { serviceCreateSchema, serviceUpdateSchema } from './owner-api.js';
import { serviceSchema } from './service.js';

describe('serviceCreateSchema – Einzeltermin', () => {
  it('setzt Standardwerte für Puffer, Raster und Fristen', () => {
    const result = serviceCreateSchema.parse({
      type: 'single',
      title: 'Herrenhaarschnitt',
      durationMinutes: 30,
    });
    expect(result).toMatchObject({
      type: 'single',
      bufferMinutes: 0,
      slotGridMinutes: 30,
      active: true,
      description: null,
      bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
    });
  });

  it.each([20, 30, 45, 60, 90])('akzeptiert Raster %i', (slotGridMinutes) => {
    expect(
      serviceCreateSchema.safeParse({
        type: 'single',
        title: 'X',
        durationMinutes: 30,
        slotGridMinutes,
      }).success,
    ).toBe(true);
  });

  it.each([15, 25, 120])('lehnt Raster %i ab', (slotGridMinutes) => {
    expect(
      serviceCreateSchema.safeParse({
        type: 'single',
        title: 'X',
        durationMinutes: 30,
        slotGridMinutes,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['Dauer kein Vielfaches von 5', { durationMinutes: 32 }],
    ['Dauer zu lang', { durationMinutes: 485 }],
    ['Dauer 0', { durationMinutes: 0 }],
    ['Puffer zu groß', { durationMinutes: 30, bufferMinutes: 65 }],
    ['Puffer kein Vielfaches von 5', { durationMinutes: 30, bufferMinutes: 7 }],
  ])('lehnt ab: %s', (_label, fields) => {
    expect(serviceCreateSchema.safeParse({ type: 'single', title: 'X', ...fields }).success).toBe(
      false,
    );
  });

  it('kennt kein Kapazitätsfeld (Kapazität ist immer 1)', () => {
    const result = serviceCreateSchema.parse({
      type: 'single',
      title: 'X',
      durationMinutes: 30,
      defaultCapacity: 5,
    });
    expect(result).not.toHaveProperty('defaultCapacity');
  });
});

describe('serviceCreateSchema – Gruppenkurs', () => {
  it('akzeptiert Kapazität ab 2', () => {
    expect(
      serviceCreateSchema.safeParse({
        type: 'group',
        title: 'Yoga',
        durationMinutes: 75,
        defaultCapacity: 12,
      }).success,
    ).toBe(true);
  });
  it.each([1, 0, 2.5])('lehnt Kapazität %s ab', (defaultCapacity) => {
    expect(
      serviceCreateSchema.safeParse({
        type: 'group',
        title: 'Yoga',
        durationMinutes: 75,
        defaultCapacity,
      }).success,
    ).toBe(false);
  });
  it('verlangt eine Kapazität', () => {
    expect(
      serviceCreateSchema.safeParse({ type: 'group', title: 'Yoga', durationMinutes: 75 }).success,
    ).toBe(false);
  });
});

describe('serviceCreateSchema – allgemein', () => {
  it('verlangt eine bekannte Terminart', () => {
    expect(
      serviceCreateSchema.safeParse({ type: 'event', title: 'X', durationMinutes: 30 }).success,
    ).toBe(false);
  });
  it('lehnt leeren Titel ab', () => {
    expect(
      serviceCreateSchema.safeParse({ type: 'single', title: '   ', durationMinutes: 30 }).success,
    ).toBe(false);
  });
  it('akzeptiert angebotsbezogene Fristen', () => {
    const result = serviceCreateSchema.parse({
      type: 'single',
      title: 'X',
      durationMinutes: 30,
      bookingRules: { minLeadMinutes: 120 },
    });
    expect(result.bookingRules).toEqual({
      minLeadMinutes: 120,
      horizonDays: null,
      changeDeadlineMinutes: null,
    });
  });
});

describe('serviceUpdateSchema', () => {
  it('setzt bei Teiländerungen keine Standardwerte', () => {
    const result = serviceUpdateSchema.parse({ type: 'single', title: 'Neu' });
    expect(result).toEqual({ type: 'single', title: 'Neu' });
  });
  it('ändert einzelne Fristen, ohne andere auf null zu setzen', () => {
    const result = serviceUpdateSchema.parse({ type: 'group', bookingRules: { horizonDays: 30 } });
    expect(result).toEqual({ type: 'group', bookingRules: { horizonDays: 30 } });
  });
  it('verlangt die Terminart', () => {
    expect(serviceUpdateSchema.safeParse({ title: 'Neu' }).success).toBe(false);
  });
  it('validiert geänderte Felder weiterhin', () => {
    expect(serviceUpdateSchema.safeParse({ type: 'group', defaultCapacity: 1 }).success).toBe(
      false,
    );
  });
});

describe('serviceSchema', () => {
  it('akzeptiert ein vollständiges Angebot aus der API', () => {
    expect(
      serviceSchema.safeParse({
        id: '65f1a2b3c4d5e6f7a8b9c0d1',
        type: 'group',
        title: 'Yoga',
        description: null,
        active: true,
        bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
        durationMinutes: 60,
        defaultCapacity: 10,
        createdAt: '2026-10-07T08:00:00Z',
        updatedAt: '2026-10-07T08:00:00Z',
      }).success,
    ).toBe(true);
  });
});
