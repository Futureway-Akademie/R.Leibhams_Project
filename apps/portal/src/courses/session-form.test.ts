import type { Session } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import { sessionToInput, validateNewSession, validateSessionChange } from './session-form.js';
import type { SessionInput } from './session-form.js';

const TZ = 'Europe/Berlin';
const SESSION: Session = {
  id: '66f1a2b3c4d5e6f708192d01',
  serviceId: '66f1a2b3c4d5e6f708192a01',
  ruleId: null,
  startsAt: '2026-10-12T16:00:00Z',
  endsAt: '2026-10-12T17:00:00Z',
  timeZone: TZ,
  capacity: 12,
  bookedCount: 3,
  status: 'scheduled',
  location: 'Raum 1',
  cancellationReason: null,
};

const input = (patch: Partial<SessionInput> = {}): SessionInput => ({
  serviceId: SESSION.serviceId,
  date: '2026-10-12',
  time: '18:00',
  capacity: '',
  location: '',
  ...patch,
});

describe('Kurstermin anlegen', () => {
  it('rechnet lokale Zeit in UTC um (Sommer- und Winterzeit)', () => {
    expect(validateNewSession(input(), TZ)).toEqual({
      ok: true,
      data: {
        serviceId: SESSION.serviceId,
        startsAt: '2026-10-12T16:00:00Z',
        capacity: null,
        location: null,
      },
    });
    const winter = validateNewSession(
      input({ date: '2026-11-02', capacity: '8', location: ' Halle ' }),
      TZ,
    );
    expect(winter.ok && winter.data).toMatchObject({
      startsAt: '2026-11-02T17:00:00Z',
      capacity: 8,
      location: 'Halle',
    });
  });

  it('meldet fehlende und ungültige Angaben', () => {
    expect(
      validateNewSession(input({ serviceId: '', date: '', time: '18:03', capacity: '1' }), TZ),
    ).toEqual({
      ok: false,
      firstError: 'serviceId',
      errors: {
        serviceId: 'Bitte einen Gruppenkurs wählen.',
        date: 'Bitte ein Datum eingeben.',
        time: 'Nur 5-Minuten-Schritte (z. B. 18:05).',
        capacity: 'Mindestens 2 Plätze.',
      },
    });
  });

  it('erkennt Uhrzeiten, die es wegen der Zeitumstellung nicht gibt', () => {
    const result = validateNewSession(input({ date: '2027-03-28', time: '02:30' }), TZ);
    expect(result.ok ? null : result.errors.time).toContain('Zeitumstellung');
  });
});

describe('Kurstermin ändern', () => {
  it('zeigt gespeicherte Werte in lokaler Zeit', () => {
    expect(sessionToInput(SESSION)).toEqual({
      serviceId: SESSION.serviceId,
      date: '2026-10-12',
      time: '18:00',
      capacity: '12',
      location: 'Raum 1',
    });
  });

  it('sendet nur Änderungen und null ohne Änderung', () => {
    const unchanged = sessionToInput(SESSION);
    expect(validateSessionChange(SESSION, unchanged)).toEqual({ ok: true, patch: null });
    expect(
      validateSessionChange(SESSION, { ...unchanged, time: '19:00', capacity: '15', location: '' }),
    ).toEqual({
      ok: true,
      patch: { startsAt: '2026-10-12T17:00:00Z', capacity: 15, location: null },
    });
  });

  it('verlangt eine Kapazität nicht unter den gebuchten Plätzen', () => {
    const result = validateSessionChange(SESSION, { ...sessionToInput(SESSION), capacity: '2' });
    expect(result).toMatchObject({
      ok: false,
      errors: { capacity: 'Mindestens 3 Plätze (bereits gebucht).' },
    });
    expect(validateSessionChange(SESSION, { ...sessionToInput(SESSION), capacity: '' }).ok).toBe(
      false,
    );
  });
});
