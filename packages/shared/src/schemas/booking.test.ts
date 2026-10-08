import { describe, expect, it } from 'vitest';
import { bookingSchema, participantSchema } from './booking.js';
import { sessionSchema } from './session.js';

const participant = {
  name: 'Erika Mustermann',
  email: 'erika@example.test',
  phone: '+49 (0)30 123456',
};

describe('participantSchema', () => {
  it('akzeptiert vollständige Angaben und trimmt', () => {
    expect(participantSchema.parse({ ...participant, name: '  Erika Mustermann ' }).name).toBe(
      'Erika Mustermann',
    );
  });
  it.each(['name', 'email', 'phone'])('verlangt %s', (field) => {
    const input = Object.fromEntries(Object.entries(participant).filter(([key]) => key !== field));
    expect(participantSchema.safeParse(input).success).toBe(false);
  });
  it.each([
    ['Name zu kurz', { name: 'E' }],
    ['ungültige E-Mail', { email: 'erika@' }],
    ['Telefon zu kurz', { phone: '12345' }],
    ['Telefon zu lang', { phone: '0'.repeat(21) }],
    ['Telefon mit Buchstaben', { phone: '030 CALL ME' }],
    ['Telefon ohne Ziffern', { phone: '+-/() ' }],
  ])('lehnt ab: %s', (_label, override) => {
    expect(participantSchema.safeParse({ ...participant, ...override }).success).toBe(false);
  });
  it.each(['030/123456', '+49 170 1234567', '(030) 12-34-56'])(
    'akzeptiert Telefonformat %s',
    (phone) => {
      expect(participantSchema.safeParse({ ...participant, phone }).success).toBe(true);
    },
  );
});

const baseBooking = {
  id: '65f1a2b3c4d5e6f7a8b9c0d1',
  serviceId: '65f1a2b3c4d5e6f7a8b9c0d2',
  type: 'single',
  sessionId: null,
  startsAt: '2026-10-08T08:00:00Z',
  endsAt: '2026-10-08T08:30:00Z',
  timeZone: 'Europe/Berlin',
  status: 'confirmed',
  participant,
  rebookedToBookingId: null,
  ownerCancellationReason: null,
  createdAt: '2026-10-07T08:00:00Z',
};

describe('bookingSchema', () => {
  it('akzeptiert eine Einzeltermin-Buchung', () => {
    expect(bookingSchema.safeParse(baseBooking).success).toBe(true);
  });
  it('verlangt sessionId genau bei Gruppenkursen', () => {
    expect(bookingSchema.safeParse({ ...baseBooking, type: 'group' }).success).toBe(false);
    expect(
      bookingSchema.safeParse({ ...baseBooking, sessionId: '65f1a2b3c4d5e6f7a8b9c0d3' }).success,
    ).toBe(false);
    expect(
      bookingSchema.safeParse({
        ...baseBooking,
        type: 'group',
        sessionId: '65f1a2b3c4d5e6f7a8b9c0d3',
      }).success,
    ).toBe(true);
  });
  it('verlangt Nachfolgebuchung genau bei Status rebooked', () => {
    expect(bookingSchema.safeParse({ ...baseBooking, status: 'rebooked' }).success).toBe(false);
    expect(
      bookingSchema.safeParse({
        ...baseBooking,
        status: 'rebooked',
        rebookedToBookingId: '65f1a2b3c4d5e6f7a8b9c0d4',
      }).success,
    ).toBe(true);
  });
  it('erlaubt eine Absagebegründung nur bei Owner-Absage', () => {
    expect(
      bookingSchema.safeParse({ ...baseBooking, ownerCancellationReason: 'Krankheit' }).success,
    ).toBe(false);
    expect(
      bookingSchema.safeParse({
        ...baseBooking,
        status: 'cancelled_by_owner',
        ownerCancellationReason: 'Krankheit',
      }).success,
    ).toBe(true);
  });
  it('lehnt unbekannte Status ab', () => {
    expect(bookingSchema.safeParse({ ...baseBooking, status: 'bestätigt' }).success).toBe(false);
  });
});

const baseSession = {
  id: '65f1a2b3c4d5e6f7a8b9c0d1',
  serviceId: '65f1a2b3c4d5e6f7a8b9c0d2',
  ruleId: null,
  startsAt: '2026-10-08T16:30:00Z',
  endsAt: '2026-10-08T17:45:00Z',
  timeZone: 'Europe/Berlin',
  capacity: 12,
  bookedCount: 12,
  status: 'scheduled',
  location: null,
  cancellationReason: null,
};

describe('sessionSchema', () => {
  it('akzeptiert einen voll belegten Kurstermin', () => {
    expect(sessionSchema.safeParse(baseSession).success).toBe(true);
  });
  it('lehnt mehr Buchungen als Kapazität ab', () => {
    expect(sessionSchema.safeParse({ ...baseSession, bookedCount: 13 }).success).toBe(false);
  });
  it('lehnt Ende vor Beginn ab', () => {
    expect(
      sessionSchema.safeParse({ ...baseSession, endsAt: '2026-10-08T16:00:00Z' }).success,
    ).toBe(false);
  });
});
