import { describe, expect, it } from 'vitest';
import {
  availableDatesQuerySchema,
  bookingRequestSchema,
  publicServicesResponseSchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
  selfServiceCancelRequestSchema,
  selfServiceRebookRequestSchema,
} from './public-api.js';

const id = '65f1a2b3c4d5e6f7a8b9c0d1';
const participant = { name: 'Max Muster', email: 'max@example.test', phone: '0170 1234567' };
const idempotencyKey = '3f1c2a9e-7b4d-4c1e-9a2b-1d2e3f4a5b6c';

describe('öffentliche Antworten enthalten keine personenbezogenen Daten', () => {
  const session = {
    id,
    serviceId: id,
    startsAt: '2026-10-08T16:30:00Z',
    endsAt: '2026-10-08T17:45:00Z',
    freeSeats: 3,
    location: 'Studio 1',
  };

  it('akzeptiert Kurstermine mit freien Plätzen', () => {
    expect(
      publicSessionsResponseSchema.safeParse({
        serviceId: id,
        timeZone: 'Europe/Berlin',
        sessions: [session],
      }).success,
    ).toBe(true);
  });

  it('lehnt Kurstermine mit Teilnehmerliste ab', () => {
    expect(
      publicSessionsResponseSchema.safeParse({
        serviceId: id,
        timeZone: 'Europe/Berlin',
        sessions: [{ ...session, participants: [participant] }],
      }).success,
    ).toBe(false);
  });

  it('lehnt Slots mit zusätzlichen Feldern ab', () => {
    expect(
      publicSlotsResponseSchema.safeParse({
        serviceId: id,
        timeZone: 'Europe/Berlin',
        slots: [
          { startsAt: '2026-10-08T08:00:00Z', endsAt: '2026-10-08T08:30:00Z', bookedBy: 'Max' },
        ],
      }).success,
    ).toBe(false);
  });

  it('liefert Angebote beider Terminarten ohne Raster oder Puffer', () => {
    const base = { id, title: 'X', description: null, durationMinutes: 30 };
    expect(
      publicServicesResponseSchema.safeParse({
        timeZone: 'Europe/Berlin',
        services: [
          { ...base, type: 'single' },
          { ...base, type: 'group' },
        ],
      }).success,
    ).toBe(true);
    expect(
      publicServicesResponseSchema.safeParse({
        timeZone: 'Europe/Berlin',
        services: [{ ...base, type: 'single', slotGridMinutes: 30 }],
      }).success,
    ).toBe(false);
  });
});

describe('bookingRequestSchema', () => {
  it('akzeptiert eine Einzeltermin-Anfrage', () => {
    expect(
      bookingRequestSchema.safeParse({
        type: 'single',
        serviceId: id,
        startsAt: '2026-10-08T08:00:00Z',
        participant,
        idempotencyKey,
        privacyAccepted: true,
      }).success,
    ).toBe(true);
  });
  it('akzeptiert eine Kurs-Anfrage', () => {
    expect(
      bookingRequestSchema.safeParse({
        type: 'group',
        sessionId: id,
        participant,
        idempotencyKey,
        privacyAccepted: true,
      }).success,
    ).toBe(true);
  });
  it('verlangt einen Idempotenzschlüssel', () => {
    expect(
      bookingRequestSchema.safeParse({ type: 'group', sessionId: id, participant }).success,
    ).toBe(false);
  });
  it('verlangt die ausdrückliche Bestätigung der Datenschutzhinweise', () => {
    const base = { type: 'group', sessionId: id, participant, idempotencyKey };
    expect(bookingRequestSchema.safeParse(base).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...base, privacyAccepted: false }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...base, privacyAccepted: 'true' }).success).toBe(
      false,
    );
  });
  it('lehnt Einzeltermin ohne Startzeit ab', () => {
    expect(
      bookingRequestSchema.safeParse({ type: 'single', serviceId: id, participant, idempotencyKey })
        .success,
    ).toBe(false);
  });
  it('lehnt unbekannte Felder ab', () => {
    expect(
      bookingRequestSchema.safeParse({
        type: 'group',
        sessionId: id,
        participant,
        idempotencyKey,
        privacyAccepted: true,
        seats: 2,
      }).success,
    ).toBe(false);
  });
});

describe('Self-Service', () => {
  it('verlangt ausdrückliche Bestätigung beim Storno', () => {
    expect(selfServiceCancelRequestSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(selfServiceCancelRequestSchema.safeParse({}).success).toBe(false);
    expect(selfServiceCancelRequestSchema.safeParse({ confirm: 'true' }).success).toBe(false);
  });
  it('verlangt ausdrückliche Bestätigung beim Umbuchen', () => {
    expect(
      selfServiceRebookRequestSchema.safeParse({ type: 'group', sessionId: id, confirm: true })
        .success,
    ).toBe(true);
    expect(selfServiceRebookRequestSchema.safeParse({ type: 'group', sessionId: id }).success).toBe(
      false,
    );
  });
});

describe('availableDatesQuerySchema', () => {
  it('erlaubt bis zu 62 Tage', () => {
    expect(
      availableDatesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-12-01' }).success,
    ).toBe(true);
    expect(
      availableDatesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-12-02' }).success,
    ).toBe(false);
  });
  it('lehnt umgekehrte Zeiträume ab', () => {
    expect(
      availableDatesQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});
