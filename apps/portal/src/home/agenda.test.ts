import type { Booking, Session } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import {
  buildAgenda,
  dayFromParam,
  dayHeading,
  formatClock,
  hasRemaining,
  nextItem,
  nextSearchRange,
  timingOf,
} from './agenda.js';

const TZ = 'Europe/Berlin';

function session(
  id: string,
  startsAt: string,
  endsAt: string,
  status: Session['status'] = 'scheduled',
): Session {
  return {
    id,
    serviceId: '66f1a2b3c4d5e6f708192a01',
    ruleId: null,
    startsAt,
    endsAt,
    timeZone: TZ,
    capacity: 12,
    bookedCount: 3,
    status,
    location: null,
    cancellationReason: null,
  };
}

function booking(
  id: string,
  startsAt: string,
  endsAt: string,
  type: Booking['type'] = 'single',
): Booking {
  return {
    id,
    serviceId: '66f1a2b3c4d5e6f708192a03',
    type,
    sessionId: type === 'group' ? 's1' : null,
    startsAt,
    endsAt,
    timeZone: TZ,
    status: 'confirmed',
    participant: { name: 'Anna Muster', email: 'anna@example.test', phone: '030 1234567' },
    rebookedToBookingId: null,
    ownerCancellationReason: null,
    createdAt: '2030-10-01T07:15:00Z',
  };
}

const MORNING = booking('b1', '2030-10-14T07:00:00Z', '2030-10-14T07:30:00Z');
const COURSE = session('s1', '2030-10-14T16:00:00Z', '2030-10-14T17:00:00Z');
const CANCELLED = session('s2', '2030-10-14T09:00:00Z', '2030-10-14T10:00:00Z', 'cancelled');
const GROUP_BOOKING = booking('b2', COURSE.startsAt, COURSE.endsAt, 'group');

describe('buildAgenda', () => {
  it('ordnet Kurstermine und Einzeltermine nach Beginn, ohne Buchungen von Kursen', () => {
    const items = buildAgenda([COURSE, CANCELLED], [GROUP_BOOKING, MORNING]);
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'single:b1',
      'session:s2',
      'session:s1',
    ]);
  });

  it('übernimmt nur bestätigte Einzeltermine', () => {
    const cancelled: Booking = { ...MORNING, id: 'b3', status: 'cancelled' };
    expect(buildAgenda([], [cancelled])).toEqual([]);
  });
});

describe('Zeitbezug', () => {
  const items = buildAgenda([COURSE, CANCELLED], [MORNING]);
  const at = (utc: string) => Date.parse(utc);

  it('unterscheidet vorbei, läuft gerade und anstehend', () => {
    const [first] = items;
    if (!first) throw new Error('Termin fehlt');
    expect(timingOf(first, at('2030-10-14T06:59:00Z'))).toBe('upcoming');
    expect(timingOf(first, at('2030-10-14T07:00:00Z'))).toBe('running');
    expect(timingOf(first, at('2030-10-14T07:30:00Z'))).toBe('past');
  });

  it('zählt abgesagte Kurstermine nicht als verbleibend oder nächsten Termin', () => {
    expect(hasRemaining(items, at('2030-10-14T08:00:00Z'))).toBe(true);
    expect(nextItem(items, at('2030-10-14T08:00:00Z'))?.id).toBe('s1');
    expect(hasRemaining(items, at('2030-10-14T17:00:00Z'))).toBe(false);
    expect(nextItem(items, at('2030-10-14T17:00:00Z'))).toBeNull();
    expect(hasRemaining(buildAgenda([CANCELLED], []), at('2030-10-14T06:00:00Z'))).toBe(false);
  });

  it('zählt gesperrte Kurstermine mit (sie finden mit ihren Teilnehmern statt)', () => {
    const blocked = buildAgenda([{ ...COURSE, status: 'blocked' }], []);
    expect(nextItem(blocked, at('2030-10-14T08:00:00Z'))?.id).toBe('s1');
  });

  it('nimmt einen laufenden Termin nicht als nächsten', () => {
    expect(nextItem(items, at('2030-10-14T07:10:00Z'))?.id).toBe('s1');
  });
});

describe('Tage', () => {
  it('liest den Tag aus der Adresse, sonst heute', () => {
    expect(dayFromParam('2030-10-14', '2026-10-10')).toBe('2030-10-14');
    expect(dayFromParam(null, '2026-10-10')).toBe('2026-10-10');
    expect(dayFromParam('2030-02-30', '2026-10-10')).toBe('2026-10-10');
    expect(dayFromParam('morgen', '2026-10-10')).toBe('2026-10-10');
  });

  it('benennt heute, morgen und gestern', () => {
    expect(dayHeading('2026-10-10', '2026-10-10')).toBe('Heute, Sa., 10.10.2026');
    expect(dayHeading('2026-10-11', '2026-10-10')).toBe('Morgen, So., 11.10.2026');
    expect(dayHeading('2026-10-09', '2026-10-10')).toBe('Gestern, Fr., 09.10.2026');
    expect(dayHeading('2026-10-14', '2026-10-10')).toBe('Mi., 14.10.2026');
  });

  it('sucht „Als Nächstes“ ab heute oder ab dem Tag nach einem künftigen Tag', () => {
    expect(nextSearchRange('2026-10-10', '2026-10-10')).toEqual({
      from: '2026-10-10',
      to: '2026-11-09',
    });
    expect(nextSearchRange('2026-10-01', '2026-10-10').from).toBe('2026-10-10');
    expect(nextSearchRange('2026-10-14', '2026-10-10')).toEqual({
      from: '2026-10-15',
      to: '2026-11-14',
    });
  });
});

describe('formatClock', () => {
  it('zeigt die Uhrzeit in der Zeitzone der Installation', () => {
    expect(formatClock(Date.parse('2030-10-14T12:32:00Z'), TZ)).toBe('14:32');
    expect(formatClock(Date.parse('2030-12-14T12:32:00Z'), TZ)).toBe('13:32');
  });
});
