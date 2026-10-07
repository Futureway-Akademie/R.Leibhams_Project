import { describe, expect, it } from 'vitest';
import {
  loginRequestSchema,
  ownerCancellationSchema,
  sessionCreateSchema,
  sessionUpdateSchema,
} from './owner-api.js';

const id = '65f1a2b3c4d5e6f7a8b9c0d1';

describe('loginRequestSchema', () => {
  it('akzeptiert E-Mail und Passwort', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'owner@example.test', password: 'geheim' }).success,
    ).toBe(true);
  });
  it('lehnt leeres Passwort ab', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'owner@example.test', password: '' }).success,
    ).toBe(false);
  });
});

describe('sessionCreateSchema', () => {
  it('setzt Kapazität und Ort standardmäßig auf null (Angebotswert gilt)', () => {
    expect(sessionCreateSchema.parse({ serviceId: id, startsAt: '2026-10-08T16:30:00Z' })).toEqual({
      serviceId: id,
      startsAt: '2026-10-08T16:30:00Z',
      capacity: null,
      location: null,
    });
  });
  it('lehnt Kapazität 1 ab', () => {
    expect(
      sessionCreateSchema.safeParse({
        serviceId: id,
        startsAt: '2026-10-08T16:30:00Z',
        capacity: 1,
      }).success,
    ).toBe(false);
  });
});

describe('sessionUpdateSchema', () => {
  it('erlaubt Sperren', () => {
    expect(sessionUpdateSchema.parse({ status: 'blocked' })).toEqual({ status: 'blocked' });
  });
  it('erlaubt kein Absagen über die Änderung', () => {
    expect(sessionUpdateSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });
});

describe('ownerCancellationSchema', () => {
  it('verlangt Bestätigung', () => {
    expect(ownerCancellationSchema.safeParse({ reason: 'Krankheit' }).success).toBe(false);
    expect(ownerCancellationSchema.parse({ confirm: true })).toEqual({
      confirm: true,
      reason: null,
    });
  });
});
