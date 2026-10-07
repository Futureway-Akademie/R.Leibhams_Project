import {
  availabilityExceptionCreatedSchema,
  availabilityExceptionSchema,
  openingHoursResponseSchema,
} from '@fw-booking/shared';
import type { AvailabilityException } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { startReplSet } from '../testing/mongo.js';
import { AvailabilityService } from './availability.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;
let availability: AvailabilityService;

const HOURS = '/api/owner/opening-hours';
const EXCEPTIONS = '/api/owner/availability-exceptions';

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  owner = await loginAsOwner(t);
  availability = t.app.get(AvailabilityService);
});

afterAll(async () => {
  await t.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(t.db);
  await Promise.all([
    c.openingHours.deleteMany({}),
    c.availabilityExceptions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.auditEvents.deleteMany({}),
  ]);
  await c.settings.updateOne({ _id: SETTINGS_ID }, { $set: { timeZone: 'Europe/Berlin' } });
});

const http = () => request(t.app.getHttpServer());
const authed = {
  get: (url: string) => http().get(url).set('Cookie', owner.cookie),
  put: (url: string, body: object) =>
    http().put(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  post: (url: string, body: object) =>
    http().post(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  delete: (url: string) =>
    http().delete(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send({}),
};

const week = {
  days: [
    {
      weekday: 2,
      windows: [
        { start: '13:00', end: '18:00' },
        { start: '09:00', end: '12:00' },
      ],
    },
    { weekday: 6, windows: [{ start: '09:00', end: '14:00' }] },
  ],
};

async function addException(body: object): Promise<AvailabilityException> {
  const response = await authed.post(EXCEPTIONS, body).expect(201);
  return availabilityExceptionCreatedSchema.parse(response.body).exception;
}

/** Fenster als ISO-Strings für übersichtliche Vergleiche. */
async function windows(date: string): Promise<[string, string][]> {
  return (await availability.openWindowsForDate(date)).map((w) => [
    w.start.toISOString().replace('.000', ''),
    w.end.toISOString().replace('.000', ''),
  ]);
}

describe('Öffnungszeiten', () => {
  it('verlangt Anmeldung und CSRF-Token', async () => {
    await http().get(HOURS).expect(401);
    await http().put(HOURS).set('Cookie', owner.cookie).send(week).expect(403);
  });

  it('ist zu Beginn leer und nennt die Zeitzone', async () => {
    const response = await authed.get(HOURS).expect(200);
    expect(openingHoursResponseSchema.parse(response.body)).toEqual({
      timeZone: 'Europe/Berlin',
      days: [],
    });
  });

  it('ersetzt den Wochenplan und sortiert Tage und Fenster', async () => {
    await authed.put(HOURS, {
      days: [{ weekday: 1, windows: [{ start: '08:00', end: '10:00' }] }],
    });
    const response = await authed.put(HOURS, week).expect(200);
    expect(response.body).toEqual({
      timeZone: 'Europe/Berlin',
      days: [
        {
          weekday: 2,
          windows: [
            { start: '09:00', end: '12:00' },
            { start: '13:00', end: '18:00' },
          ],
        },
        { weekday: 6, windows: [{ start: '09:00', end: '14:00' }] },
      ],
    });
    expect((await authed.get(HOURS).expect(200)).body).toEqual(response.body);
  });

  it.each([
    [
      'überlappende Fenster',
      [
        {
          weekday: 1,
          windows: [
            { start: '09:00', end: '12:30' },
            { start: '12:00', end: '14:00' },
          ],
        },
      ],
    ],
    [
      'Zeit außerhalb des 5-Minuten-Rasters',
      [{ weekday: 1, windows: [{ start: '09:07', end: '12:00' }] }],
    ],
    [
      'doppelter Wochentag',
      [
        { weekday: 1, windows: [{ start: '09:00', end: '10:00' }] },
        { weekday: 1, windows: [{ start: '11:00', end: '12:00' }] },
      ],
    ],
    ['Ende vor Beginn', [{ weekday: 1, windows: [{ start: '18:00', end: '09:00' }] }]],
  ])('lehnt ab: %s', async (_label, days) => {
    await authed.put(HOURS, week).expect(200);
    await authed.put(HOURS, { days }).expect(400);
    expect(((await authed.get(HOURS).expect(200)).body as { days: unknown[] }).days).toHaveLength(
      2,
    );
  });

  it('kann alle Tage schließen und protokolliert die Änderung', async () => {
    await authed.put(HOURS, week).expect(200);
    await authed.put(HOURS, { days: [] }).expect(200);
    expect(await collections(t.db).openingHours.countDocuments()).toBe(0);
    const events = await collections(t.db)
      .auditEvents.find({ action: 'openingHours.replaced' })
      .toArray();
    expect(events.map((e) => e.details)).toEqual([{ weekdays: [2, 6] }, { weekdays: [] }]);
  });
});

describe('Ausnahmen', () => {
  it('legt Sperrzeit an, listet und löscht sie', async () => {
    const exception = await addException({
      kind: 'closed',
      start: '2026-12-24T00:00',
      end: '2027-01-02T00:00',
      note: 'Weihnachtsurlaub',
    });
    expect(exception).toMatchObject({ kind: 'closed', note: 'Weihnachtsurlaub' });

    const list = (await authed.get(`${EXCEPTIONS}?from=2026-12-01`).expect(200)).body as unknown[];
    expect(list.map((e) => availabilityExceptionSchema.parse(e).id)).toEqual([exception.id]);

    await authed.delete(`${EXCEPTIONS}/${exception.id}`).expect(204);
    await authed.delete(`${EXCEPTIONS}/${exception.id}`).expect(404);
    expect((await authed.get(`${EXCEPTIONS}?from=2026-12-01`).expect(200)).body).toEqual([]);
  });

  it('filtert nach Zeitraum (berührende Ausnahmen eingeschlossen)', async () => {
    const before = await addException({
      kind: 'closed',
      start: '2026-11-01T10:00',
      end: '2026-11-01T12:00',
    });
    const spanning = await addException({
      kind: 'closed',
      start: '2026-11-09T00:00',
      end: '2026-11-12T00:00',
    });
    const inside = await addException({
      kind: 'extra_opening',
      start: '2026-11-15T10:00',
      end: '2026-11-15T14:00',
    });
    await addException({ kind: 'closed', start: '2026-11-21T10:00', end: '2026-11-21T12:00' });

    const list = (await authed.get(`${EXCEPTIONS}?from=2026-11-10&to=2026-11-20`).expect(200))
      .body as AvailabilityException[];
    expect(list.map((e) => e.id)).toEqual([spanning.id, inside.id]);
    expect(list.map((e) => e.id)).not.toContain(before.id);
    await authed.get(`${EXCEPTIONS}?from=2026-11-20&to=2026-11-10`).expect(400);
  });

  it('meldet bestätigte Buchungen im gesperrten Zeitraum, ohne sie abzusagen', async () => {
    const booking = (startsAt: string, endsAt: string, status: 'confirmed' | 'cancelled') => ({
      _id: new ObjectId(),
      serviceId: new ObjectId(),
      type: 'single' as const,
      sessionId: null,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      timeZone: 'Europe/Berlin',
      status,
      participant: { name: 'Erika', email: 'erika@example.test', phone: '030 123456' },
      participantEmailKey: 'erika@example.test',
      idempotencyKey: new ObjectId().toHexString(),
      rebookedToBookingId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // 10:00 Ortszeit am 03.12.2026 = 09:00Z
    await collections(t.db).bookings.insertMany([
      booking('2026-12-03T09:00:00Z', '2026-12-03T09:30:00Z', 'confirmed'),
      booking('2026-12-03T10:30:00Z', '2026-12-03T11:00:00Z', 'confirmed'),
      booking('2026-12-03T09:00:00Z', '2026-12-03T09:30:00Z', 'cancelled'),
      booking('2026-12-03T12:00:00Z', '2026-12-03T12:30:00Z', 'confirmed'),
    ]);
    const response = await authed
      .post(EXCEPTIONS, { kind: 'closed', start: '2026-12-03T10:00', end: '2026-12-03T12:00' })
      .expect(201);
    expect((response.body as { conflictingBookings: number }).conflictingBookings).toBe(2);
    expect(await collections(t.db).bookings.countDocuments({ status: 'confirmed' })).toBe(3);
  });

  it.each([
    ['Ende vor Beginn', { kind: 'closed', start: '2026-12-24T12:00', end: '2026-12-24T10:00' }],
    [
      'außerhalb des Rasters',
      { kind: 'closed', start: '2026-12-24T10:03', end: '2026-12-24T12:00' },
    ],
    [
      'UTC statt Ortszeit',
      { kind: 'closed', start: '2026-12-24T10:00:00Z', end: '2026-12-24T12:00:00Z' },
    ],
    ['unbekannte Art', { kind: 'holiday', start: '2026-12-24T10:00', end: '2026-12-24T12:00' }],
  ])('lehnt ab: %s', async (_label, body) => {
    await authed.post(EXCEPTIONS, body).expect(400);
  });

  it('liefert 400 für ungültige IDs beim Löschen', async () => {
    await authed.delete(`${EXCEPTIONS}/keine-id`).expect(400);
  });
});

describe('openWindowsForDate', () => {
  beforeEach(async () => {
    await authed.put(HOURS, week).expect(200);
  });

  it('rechnet den Wochenplan in UTC um (Winterzeit, UTC+1)', async () => {
    // 01.12.2026 ist ein Dienstag.
    expect(await windows('2026-12-01')).toEqual([
      ['2026-12-01T08:00:00Z', '2026-12-01T11:00:00Z'],
      ['2026-12-01T12:00:00Z', '2026-12-01T17:00:00Z'],
    ]);
  });

  it('rechnet in Sommerzeit mit UTC+2', async () => {
    // 07.07.2026 ist ein Dienstag.
    expect((await windows('2026-07-07'))[0]).toEqual([
      '2026-07-07T07:00:00Z',
      '2026-07-07T10:00:00Z',
    ]);
  });

  it('liefert keine Fenster an geschlossenen Wochentagen', async () => {
    expect(await windows('2026-12-02')).toEqual([]);
  });

  it('schneidet Sperrzeiten heraus', async () => {
    await addException({ kind: 'closed', start: '2026-12-01T10:00', end: '2026-12-01T14:00' });
    expect(await windows('2026-12-01')).toEqual([
      ['2026-12-01T08:00:00Z', '2026-12-01T09:00:00Z'],
      ['2026-12-01T13:00:00Z', '2026-12-01T17:00:00Z'],
    ]);
  });

  it('berücksichtigt mehrtägigen Urlaub an jedem Tag', async () => {
    await addException({ kind: 'closed', start: '2026-11-28T00:00', end: '2026-12-02T00:00' });
    expect(await windows('2026-11-28')).toEqual([]);
    expect(await windows('2026-12-01')).toEqual([]);
    expect(await windows('2026-12-08')).toHaveLength(2);
  });

  it('fügt zusätzliche Öffnungen hinzu und vereinigt angrenzende Fenster', async () => {
    await addException({
      kind: 'extra_opening',
      start: '2026-12-01T12:00',
      end: '2026-12-01T13:00',
    });
    await addException({
      kind: 'extra_opening',
      start: '2026-12-06T10:00',
      end: '2026-12-06T14:00',
    });
    expect(await windows('2026-12-01')).toEqual([['2026-12-01T08:00:00Z', '2026-12-01T17:00:00Z']]);
    // 06.12.2026 ist ein Sonntag ohne Wochenplan.
    expect(await windows('2026-12-06')).toEqual([['2026-12-06T09:00:00Z', '2026-12-06T13:00:00Z']]);
  });

  it('lässt Sperrzeiten vor zusätzlichen Öffnungen gelten', async () => {
    await addException({ kind: 'closed', start: '2026-12-06T00:00', end: '2026-12-07T00:00' });
    await addException({
      kind: 'extra_opening',
      start: '2026-12-06T10:00',
      end: '2026-12-06T14:00',
    });
    expect(await windows('2026-12-06')).toEqual([]);
  });

  it('begrenzt tagesübergreifende Ausnahmen auf den Tag', async () => {
    await addException({
      kind: 'extra_opening',
      start: '2026-12-06T22:00',
      end: '2026-12-07T02:00',
    });
    expect(await windows('2026-12-06')).toEqual([['2026-12-06T21:00:00Z', '2026-12-06T23:00:00Z']]);
    expect(await windows('2026-12-07')).toEqual([['2026-12-06T23:00:00Z', '2026-12-07T01:00:00Z']]);
  });

  it('interpretiert 24:00 als Mitternacht des Folgetags', async () => {
    await authed.put(HOURS, {
      days: [{ weekday: 5, windows: [{ start: '20:00', end: '24:00' }] }],
    });
    // 04.12.2026 ist ein Freitag.
    expect(await windows('2026-12-04')).toEqual([['2026-12-04T19:00:00Z', '2026-12-04T23:00:00Z']]);
  });

  describe('Zeitumstellung', () => {
    beforeEach(async () => {
      await authed.put(HOURS, {
        days: [{ weekday: 7, windows: [{ start: '01:00', end: '04:00' }] }],
      });
    });

    it('Sommerzeitbeginn 29.03.2026: 3 lokale Stunden sind 2 echte Stunden', async () => {
      expect(await windows('2026-03-29')).toEqual([
        ['2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z'],
      ]);
    });

    it('Winterzeitbeginn 25.10.2026: 3 lokale Stunden sind 4 echte Stunden', async () => {
      expect(await windows('2026-10-25')).toEqual([
        ['2026-10-24T23:00:00Z', '2026-10-25T03:00:00Z'],
      ]);
    });

    it('Fensterbeginn in der übersprungenen Stunde öffnet zur Umstellung', async () => {
      await authed.put(HOURS, {
        days: [{ weekday: 7, windows: [{ start: '02:30', end: '05:00' }] }],
      });
      expect(await windows('2026-03-29')).toEqual([
        ['2026-03-29T01:00:00Z', '2026-03-29T03:00:00Z'],
      ]);
    });
  });

  it('nutzt die Zeitzone der Installation', async () => {
    await collections(t.db).settings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { timeZone: 'America/New_York' } },
    );
    expect((await windows('2026-12-01'))[0]).toEqual([
      '2026-12-01T14:00:00Z',
      '2026-12-01T17:00:00Z',
    ]);
  });
});
