import {
  availableDatesResponseSchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
  selfServiceBookingSchema,
} from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type {
  BookingDocument,
  GroupServiceDocument,
  SessionDocument,
  SingleServiceDocument,
} from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { checkConsistency } from '../testing/consistency.js';
import { groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { ActionTokenService } from './action-token.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let tokens: ActionTokenService;
let base: string;

const RULES = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };
const DATE = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  tokens = t.app.get(ActionTokenService);
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  base = `/api/public/calendars/${settings?.publicCalendarId ?? ''}`;
});

afterAll(async () => {
  await t.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.sessions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.outboxJobs.deleteMany({}),
    c.auditEvents.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
    c.actionTokens.deleteMany({}),
    c.openingHours.deleteMany({}),
  ]);
  await c.openingHours.insertMany(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      _id: new ObjectId(),
      weekday,
      windows: [{ start: '09:00', end: '12:00' }],
    })),
  );
});

const http = () => request(t.app.getHttpServer());
let counter = 0;
const participant = () => ({
  name: 'Erika Mustermann',
  email: `erika${String(++counter)}@example.test`,
  phone: '030 123456',
});
const withToken = (r: request.Test, token: string) => r.set('X-Booking-Token', token);
const rebook = (token: string, body: object) =>
  withToken(http().post('/api/public/manage/rebook'), token).send({ confirm: true, ...body });
const consistent = async () => {
  expect(await checkConsistency(t.db)).toEqual([]);
};

// ---------- Einzeltermine ----------

async function singleSetup(serviceOverrides: Partial<SingleServiceDocument> = {}) {
  const service = singleService({ bookingRules: RULES, ...serviceOverrides });
  await collections(t.db).services.insertOne(service);
  const slots = publicSlotsResponseSchema
    .parse(
      (await http().get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)).body,
    )
    .slots.map((s) => s.startsAt);
  const bookAt = async (startsAt: string) => {
    await http()
      .post(`${base}/bookings`)
      .send({
        type: 'single',
        serviceId: service._id.toHexString(),
        startsAt,
        participant: participant(),
        idempotencyKey: `rebook-test-${String(++counter)}-xyz`,
        privacyAccepted: true,
      })
      .expect(201);
    const booking = await collections(t.db).bookings.findOne({ startsAt: new Date(startsAt) });
    if (!booking) throw new Error('Buchung fehlt');
    return { booking, token: await tokens.issue(booking) };
  };
  return { service, slots, bookAt };
}

describe('Umbuchung eines Einzeltermins', () => {
  it('bietet andere Startzeiten an, inklusive Überschneidung mit der eigenen Zeit', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? ''); // 09:00–09:30
    const response = await withToken(
      http().get(`/api/public/manage/slots?date=${DATE}`),
      token,
    ).expect(200);
    const options = publicSlotsResponseSchema.parse(response.body).slots.map((s) => s.startsAt);
    expect(options).not.toContain(slots[0]);
    expect(options).toContain(slots[3]); // 09:15 überschneidet die eigene Zeit
    expect(options).toHaveLength(slots.length - 1);
  });

  it('nennt Tage mit möglichen neuen Startzeiten, ohne Cache und mit der eigenen Zeit als frei', async () => {
    const { service, slots, bookAt } = await singleSetup();
    // slots[i] = 09:00 + 5·i Minuten (Berlin). Eigene Buchung 09:10–09:40.
    const { token } = await bookAt(slots[2] ?? '');
    const dates = (to: string) =>
      withToken(http().get(`/api/public/manage/available-dates?from=${DATE}&to=${to}`), token);
    const response = await dates(DATE).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(availableDatesResponseSchema.parse(response.body)).toMatchObject({ dates: [DATE] });

    // Rest des Vormittags belegen (09:40–11:40); übrig bleiben 20 Minuten am Ende.
    for (const i of [8, 14, 20, 26]) await bookAt(slots[i] ?? '');
    const publicDates = await http().get(
      `${base}/services/${service._id.toHexString()}/available-dates?from=${DATE}&to=${DATE}`,
    );
    expect(publicDates.body).toMatchObject({ dates: [] });
    // Für die Umbuchung bleiben 09:00 und 09:05 möglich (überschneiden nur die eigene Zeit).
    expect((await dates(DATE).expect(200)).body).toMatchObject({ dates: [DATE] });
    const options = await withToken(
      http().get(`/api/public/manage/slots?date=${DATE}`),
      token,
    ).expect(200);
    expect(publicSlotsResponseSchema.parse(options.body).slots.map((s) => s.startsAt)).toEqual([
      slots[0],
      slots[1],
    ]);
  });

  it('lehnt available-dates ohne gültiges Token, für Kurse und mit zu großem Zeitraum ab', async () => {
    await withToken(
      http().get(`/api/public/manage/available-dates?from=${DATE}&to=${DATE}`),
      'x'.repeat(43),
    ).expect(404);
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    await withToken(
      http().get(`/api/public/manage/available-dates?from=${DATE}&to=2099-12-31`),
      token,
    ).expect(400);
  });

  it('bucht um: neue Buchung, alte als umgebucht, Belegung, Auftrag, Links übertragen', async () => {
    const { slots, bookAt } = await singleSetup();
    const { booking, token } = await bookAt(slots[0] ?? '');
    const response = await rebook(token, { type: 'single', startsAt: slots[12] }).expect(200); // 10:00
    expect(response.body).toMatchObject({
      status: 'confirmed',
      startsAt: slots[12],
      canCancel: true,
      canRebook: false,
      alreadyRebooked: false,
    });

    const old = await collections(t.db).bookings.findOne({ _id: booking._id });
    expect(old?.status).toBe('rebooked');
    const fresh = await collections(t.db).bookings.findOne({
      _id: old?.rebookedToBookingId as ObjectId,
    });
    expect(fresh).toMatchObject({
      status: 'confirmed',
      participantEmailKey: booking.participantEmailKey,
    });
    expect(await collections(t.db).outboxJobs.findOne({ type: 'booking_rebooked' })).toMatchObject({
      bookingId: fresh?._id,
    });
    expect(await collections(t.db).auditEvents.countDocuments({ action: 'booking.rebooked' })).toBe(
      1,
    );

    // Der bisherige Link zeigt jetzt die neue Buchung.
    const view = selfServiceBookingSchema.parse(
      (await withToken(http().get('/api/public/manage'), token).expect(200)).body,
    );
    expect(view).toMatchObject({ startsAt: slots[12], status: 'confirmed', canRebook: false });
    await consistent();
  });

  it('verschiebt um wenige Minuten mit Überschneidung der eigenen Zeit', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    await rebook(token, { type: 'single', startsAt: slots[3] }).expect(200); // 09:00 → 09:15
    const units = await collections(t.db)
      .resourceOccupancy.find({}, { sort: { unitStart: 1 } })
      .toArray();
    expect(units).toHaveLength(6);
    expect(units[0]?.unitStart.toISOString()).toBe(new Date(slots[3] ?? '').toISOString());
    await consistent();
  });

  it('lässt die ursprüngliche Buchung unverändert, wenn das Ziel belegt ist', async () => {
    const { slots, bookAt } = await singleSetup();
    const { booking, token } = await bookAt(slots[0] ?? '');
    await bookAt(slots[12] ?? ''); // jemand anderes 10:00–10:30
    const response = await rebook(token, { type: 'single', startsAt: slots[15] }).expect(409); // 10:15
    expect(response.body).toMatchObject({ code: 'slot_taken' });
    expect((await collections(t.db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
    expect(await collections(t.db).resourceOccupancy.countDocuments({ refId: booking._id })).toBe(
      6,
    );
    await consistent();
  });

  it('lehnt Zeiten ohne berechnete Startzeit ab', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    const outside = new Date(Date.parse(slots[0] ?? '') + 4 * 3600_000).toISOString(); // 13:00
    expect(
      (await rebook(token, { type: 'single', startsAt: outside }).expect(409)).body,
    ).toMatchObject({
      code: 'not_bookable',
    });
  });

  it('erlaubt höchstens eine Umbuchung, Storno bleibt möglich', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    await rebook(token, { type: 'single', startsAt: slots[12] }).expect(200);
    expect(
      (await rebook(token, { type: 'single', startsAt: slots[20] }).expect(409)).body,
    ).toMatchObject({
      code: 'rebook_not_allowed',
    });
    await withToken(http().post('/api/public/manage/cancel'), token)
      .send({ confirm: true })
      .expect(200);
    expect(await collections(t.db).resourceOccupancy.countDocuments()).toBe(0);
    await consistent();
  });

  it('behandelt Doppelklicks als bereits umgebucht', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    await rebook(token, { type: 'single', startsAt: slots[12] }).expect(200);
    expect(
      (await rebook(token, { type: 'single', startsAt: slots[12] }).expect(200)).body,
    ).toMatchObject({
      alreadyRebooked: true,
    });
  });

  it('bucht bei gleichzeitigen Doppelklicks genau einmal um', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => rebook(token, { type: 'single', startsAt: slots[12] })),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(
      responses.filter((r) => !(r.body as { alreadyRebooked: boolean }).alreadyRebooked),
    ).toHaveLength(1);
    expect(await collections(t.db).bookings.countDocuments({ status: 'confirmed' })).toBe(1);
    await consistent();
  });

  it('prüft Frist, Terminart und gleichen Termin', async () => {
    const { slots, bookAt } = await singleSetup({
      bookingRules: { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: 5 * 24 * 60 },
    });
    const { token } = await bookAt(slots[0] ?? '');
    expect(
      (await rebook(token, { type: 'single', startsAt: slots[12] }).expect(409)).body,
    ).toMatchObject({
      code: 'change_deadline_passed',
    });
    await rebook(token, { type: 'group', sessionId: new ObjectId().toHexString() }).expect(400);
  });

  it('lehnt die Umbuchung auf den eigenen Termin ab und verlangt Bestätigung', async () => {
    const { slots, bookAt } = await singleSetup();
    const { token } = await bookAt(slots[0] ?? '');
    await rebook(token, { type: 'single', startsAt: slots[0] }).expect(400);
    await withToken(http().post('/api/public/manage/rebook'), token)
      .send({ type: 'single', startsAt: slots[12] })
      .expect(400);
  });
});

// ---------- Gruppenkurse ----------

async function groupSetup(capacities: number[], overrides: Partial<GroupServiceDocument> = {}) {
  const service = groupService({ bookingRules: RULES, ...overrides });
  await collections(t.db).services.insertOne(service);
  const sessions: SessionDocument[] = capacities.map((capacity, i) => {
    const startsAt = new Date(`${DATE}T${String(14 + i * 2)}:00:00Z`);
    return {
      _id: new ObjectId(),
      serviceId: service._id,
      ruleId: null,
      localStart: `${DATE}T${String(16 + i * 2)}:00`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 75 * 60_000),
      timeZone: 'Europe/Berlin',
      capacity,
      bookedCount: 0,
      status: 'scheduled',
      location: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await collections(t.db).sessions.insertMany(sessions);
  const bookIn = async (session: SessionDocument) => {
    const p = participant();
    await http()
      .post(`${base}/bookings`)
      .send({
        type: 'group',
        sessionId: session._id.toHexString(),
        participant: p,
        idempotencyKey: `rebook-test-${String(++counter)}-xyz`,
        privacyAccepted: true,
      })
      .expect(201);
    const booking = (await collections(t.db).bookings.findOne({
      participantEmailKey: p.email,
    })) as BookingDocument;
    return { booking, token: await tokens.issue(booking) };
  };
  return { service, sessions, bookIn };
}

describe('Umbuchung eines Kursplatzes', () => {
  it('bietet available-dates nur für Einzeltermine an', async () => {
    const { sessions, bookIn } = await groupSetup([3]);
    const [session] = sessions;
    if (!session) throw new Error();
    const { token } = await bookIn(session);
    await withToken(
      http().get(`/api/public/manage/available-dates?from=${DATE}&to=${DATE}`),
      token,
    ).expect(400);
  });

  it('bietet andere Termine desselben Kurses an, auch ausgebuchte', async () => {
    const { sessions, bookIn } = await groupSetup([3, 2, 2]);
    const [a, b, c] = sessions;
    if (!a || !b || !c) throw new Error();
    const { token } = await bookIn(a);
    await bookIn(b);
    await bookIn(b); // b ist danach voll
    const response = await withToken(
      http().get(`/api/public/manage/sessions?from=${DATE}&to=${DATE}`),
      token,
    ).expect(200);
    const options = publicSessionsResponseSchema.parse(response.body).sessions;
    expect(options.map((s) => [s.id, s.freeSeats])).toEqual([
      [b._id.toHexString(), 0],
      [c._id.toHexString(), 2],
    ]);
  });

  it('verschiebt den Platz in einen anderen Kurstermin', async () => {
    const { sessions, bookIn } = await groupSetup([3, 3]);
    const [a, b] = sessions;
    if (!a || !b) throw new Error();
    const { token } = await bookIn(a);
    const response = await rebook(token, { type: 'group', sessionId: b._id.toHexString() }).expect(
      200,
    );
    expect(response.body).toMatchObject({ status: 'confirmed', canRebook: false });
    expect((await collections(t.db).sessions.findOne({ _id: a._id }))?.bookedCount).toBe(0);
    expect((await collections(t.db).sessions.findOne({ _id: b._id }))?.bookedCount).toBe(1);
    await consistent();
  });

  it('lässt die Buchung unverändert, wenn der Zieltermin voll ist', async () => {
    const { sessions, bookIn } = await groupSetup([3, 2]);
    const [a, b] = sessions;
    if (!a || !b) throw new Error();
    const { booking, token } = await bookIn(a);
    await bookIn(b);
    await bookIn(b);
    expect(
      (await rebook(token, { type: 'group', sessionId: b._id.toHexString() }).expect(409)).body,
    ).toMatchObject({
      code: 'session_full',
    });
    expect((await collections(t.db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
    expect((await collections(t.db).sessions.findOne({ _id: a._id }))?.bookedCount).toBe(1);
    await consistent();
  });

  it('vergibt bei gleichzeitigen Umbuchungen den letzten Platz genau einmal', async () => {
    const { sessions, bookIn } = await groupSetup([5, 2]);
    const [a, b] = sessions;
    if (!a || !b) throw new Error();
    await bookIn(b); // ein Platz in b bleibt frei
    const people = await Promise.all([bookIn(a), bookIn(a), bookIn(a), bookIn(a)]);
    const responses = await Promise.all(
      people.map((p) => rebook(p.token, { type: 'group', sessionId: b._id.toHexString() })),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await collections(t.db).sessions.findOne({ _id: a._id }))?.bookedCount).toBe(3);
    expect((await collections(t.db).sessions.findOne({ _id: b._id }))?.bookedCount).toBe(2);
    await consistent();
  });

  it('lehnt Termine eines anderen Kurses ab', async () => {
    const { sessions, bookIn } = await groupSetup([3]);
    const other = await groupSetup([3], { title: 'Pilates' });
    const [a] = sessions;
    const [foreign] = other.sessions;
    if (!a || !foreign) throw new Error();
    const { token } = await bookIn(a);
    expect(
      (await rebook(token, { type: 'group', sessionId: foreign._id.toHexString() }).expect(409))
        .body,
    ).toMatchObject({ code: 'not_bookable' });
  });
});
