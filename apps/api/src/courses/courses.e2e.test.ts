import { courseRuleResultSchema, sessionSchema } from '@fw-booking/shared';
import type { Session } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { groupBooking, groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;

const SESSIONS = '/api/owner/sessions';
const RULES = '/api/owner/course-rules';

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  owner = await loginAsOwner(t);
});

afterAll(async () => {
  await t.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.courseRules.deleteMany({}),
    c.sessions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
  ]);
  await c.settings.updateOne({ _id: SETTINGS_ID }, { $set: { timeZone: 'Europe/Berlin' } });
});

const http = () => request(t.app.getHttpServer());
const authed = {
  get: (url: string) => http().get(url).set('Cookie', owner.cookie),
  post: (url: string, body: object) =>
    http().post(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  patch: (url: string, body: object) =>
    http().patch(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  delete: (url: string) =>
    http().delete(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send({}),
};

/** Ein Zeitpunkt in `days` Tagen um 16:00Z, auf dem 5-Minuten-Raster. */
function future(days: number, hourUtc = 16): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString().replace('.000Z', 'Z');
}

async function insertGroup(overrides = {}) {
  const svc = groupService(overrides);
  await collections(t.db).services.insertOne(svc);
  return svc;
}

async function createSession(serviceId: ObjectId, startsAt = future(7)): Promise<Session> {
  const response = await authed
    .post(SESSIONS, { serviceId: serviceId.toHexString(), startsAt })
    .expect(201);
  return sessionSchema.parse(response.body);
}

describe('Kurstermine', () => {
  it('verlangt Anmeldung', async () => {
    await http().get(SESSIONS).expect(401);
  });

  it('legt einen Termin mit Ende aus der Kursdauer und Standardkapazität an', async () => {
    const svc = await insertGroup();
    const startsAt = future(7);
    const session = await createSession(svc._id, startsAt);
    expect(session).toMatchObject({
      serviceId: svc._id.toHexString(),
      ruleId: null,
      startsAt,
      capacity: 12,
      bookedCount: 0,
      status: 'scheduled',
      timeZone: 'Europe/Berlin',
    });
    expect(Date.parse(session.endsAt) - Date.parse(startsAt)).toBe(75 * 60_000);
    expect(
      await collections(t.db).resourceOccupancy.countDocuments({
        refId: new ObjectId(session.id),
      }),
    ).toBe(15);
  });

  it.each([
    ['Startzeit außerhalb des Rasters', { startsAt: future(7).replace(':00:00Z', ':03:00Z') }, 400],
    ['Startzeit in der Vergangenheit', { startsAt: future(-1) }, 400],
    ['Kapazität 1', { startsAt: future(7), capacity: 1 }, 400],
  ])('lehnt ab: %s', async (_label, body, status) => {
    const svc = await insertGroup();
    await authed.post(SESSIONS, { serviceId: svc._id.toHexString(), ...body }).expect(status);
  });

  it('lehnt Einzeltermin-Angebote und deaktivierte Kurse ab', async () => {
    const single = singleService();
    await collections(t.db).services.insertOne(single);
    await authed
      .post(SESSIONS, { serviceId: single._id.toHexString(), startsAt: future(7) })
      .expect(400);
    const inactive = await insertGroup({ active: false });
    await authed
      .post(SESSIONS, { serviceId: inactive._id.toHexString(), startsAt: future(7) })
      .expect(409);
  });

  it('verhindert Überschneidungen ohne Teildaten zu hinterlassen', async () => {
    const svc = await insertGroup();
    await createSession(svc._id, future(7, 16));
    const units = await collections(t.db).resourceOccupancy.countDocuments();
    await authed
      .post(SESSIONS, { serviceId: svc._id.toHexString(), startsAt: future(7, 17) })
      .expect(409);
    expect(await collections(t.db).sessions.countDocuments()).toBe(1);
    expect(await collections(t.db).resourceOccupancy.countDocuments()).toBe(units);
  });

  it('verhindert Überschneidungen mit gebuchten Einzelterminen', async () => {
    const svc = await insertGroup();
    const start = Date.parse(future(7, 16));
    await collections(t.db).resourceOccupancy.insertOne({
      _id: new ObjectId(),
      resourceId: 'default',
      unitStart: new Date(start + 30 * 60_000),
      refType: 'booking',
      refId: new ObjectId(),
    });
    await authed
      .post(SESSIONS, { serviceId: svc._id.toHexString(), startsAt: future(7, 16) })
      .expect(409);
  });

  it('listet nach Zeitraum, Angebot und Status', async () => {
    const yoga = await insertGroup();
    const pilates = await insertGroup({ title: 'Pilates' });
    const a = await createSession(yoga._id, future(3));
    const b = await createSession(pilates._id, future(10));
    await authed.delete(`${SESSIONS}/${a.id}`).expect(204);
    const c = await createSession(yoga._id, future(12));

    const all = (await authed.get(SESSIONS).expect(200)).body as Session[];
    expect(all.map((s) => s.id)).toEqual([b.id, c.id]);
    const yogaOnly = (
      await authed.get(`${SESSIONS}?serviceId=${yoga._id.toHexString()}`).expect(200)
    ).body as Session[];
    expect(yogaOnly.map((s) => s.id)).toEqual([c.id]);
    const to = future(11).slice(0, 10);
    const until = (await authed.get(`${SESSIONS}?to=${to}`).expect(200)).body as Session[];
    expect(until.map((s) => s.id)).toEqual([b.id]);
    await authed.get(`${SESSIONS}?from=2026-12-01&to=2026-11-01`).expect(400);
  });

  describe('ändern', () => {
    it('ändert Kapazität und Ort, aber nicht unter die gebuchten Plätze', async () => {
      const svc = await insertGroup();
      const session = await createSession(svc._id);
      await collections(t.db).sessions.updateOne(
        { _id: new ObjectId(session.id) },
        { $set: { bookedCount: 5 } },
      );
      await authed.patch(`${SESSIONS}/${session.id}`, { capacity: 4 }).expect(409);
      const ok = await authed
        .patch(`${SESSIONS}/${session.id}`, { capacity: 5, location: 'Halle' })
        .expect(200);
      expect(ok.body).toMatchObject({ capacity: 5, location: 'Halle' });
    });

    it('sperrt und entsperrt, die Ressource bleibt belegt', async () => {
      const svc = await insertGroup();
      const session = await createSession(svc._id);
      const blocked = await authed
        .patch(`${SESSIONS}/${session.id}`, { status: 'blocked' })
        .expect(200);
      expect((blocked.body as Session).status).toBe('blocked');
      expect(
        await collections(t.db).resourceOccupancy.countDocuments({
          refId: new ObjectId(session.id),
        }),
      ).toBe(15);
      await authed.patch(`${SESSIONS}/${session.id}`, { status: 'scheduled' }).expect(200);
      await authed.patch(`${SESSIONS}/${session.id}`, { status: 'cancelled' }).expect(400);
    });

    it('verschiebt ohne Buchungen samt Belegung', async () => {
      const svc = await insertGroup();
      const session = await createSession(svc._id, future(7, 16));
      const moved = await authed
        .patch(`${SESSIONS}/${session.id}`, { startsAt: future(8, 9) })
        .expect(200);
      expect((moved.body as Session).startsAt).toBe(future(8, 9));
      const units = await collections(t.db)
        .resourceOccupancy.find({ refId: new ObjectId(session.id) }, { sort: { unitStart: 1 } })
        .toArray();
      expect(units).toHaveLength(15);
      expect(units[0]?.unitStart.toISOString()).toBe(new Date(future(8, 9)).toISOString());
    });

    it('verschiebt nicht, wenn es Buchungen gibt oder die neue Zeit belegt ist', async () => {
      const svc = await insertGroup();
      const a = await createSession(svc._id, future(7, 16));
      const b = await createSession(svc._id, future(7, 9));
      await authed.patch(`${SESSIONS}/${b.id}`, { startsAt: future(7, 16) }).expect(409);
      expect((await authed.get(`${SESSIONS}/${b.id}`).expect(200)).body).toMatchObject({
        startsAt: future(7, 9),
      });
      await collections(t.db).bookings.insertOne(groupBooking(new ObjectId(a.id), svc._id));
      await authed.patch(`${SESSIONS}/${a.id}`, { startsAt: future(9, 16) }).expect(409);
    });
  });

  describe('entfernen', () => {
    it('löscht manuelle Termine ohne Buchungen samt Belegung', async () => {
      const svc = await insertGroup();
      const session = await createSession(svc._id);
      await authed.delete(`${SESSIONS}/${session.id}`).expect(204);
      await authed.get(`${SESSIONS}/${session.id}`).expect(404);
      expect(await collections(t.db).resourceOccupancy.countDocuments()).toBe(0);
    });

    it('lehnt Termine mit Buchungshistorie ab', async () => {
      const svc = await insertGroup();
      const session = await createSession(svc._id);
      await collections(t.db).bookings.insertOne(
        groupBooking(new ObjectId(session.id), svc._id, { status: 'cancelled' }),
      );
      await authed.delete(`${SESSIONS}/${session.id}`).expect(409);
    });
  });
});

describe('Kursregeln', () => {
  const ruleBody = (serviceId: ObjectId) => ({
    serviceId: serviceId.toHexString(),
    weekdays: [1, 3, 5],
    startTime: '18:30',
    validFrom: new Date().toISOString().slice(0, 10),
  });

  it('legt eine Regel an und erzeugt Termine', async () => {
    const svc = await insertGroup({
      bookingRules: { minLeadMinutes: null, horizonDays: 21, changeDeadlineMinutes: null },
    });
    const response = await authed.post(RULES, ruleBody(svc._id)).expect(201);
    const result = courseRuleResultSchema.parse(response.body);
    expect(result.generation.created).toBeGreaterThanOrEqual(8);
    expect(result.rule).toMatchObject({
      weekdays: [1, 3, 5],
      startTime: '18:30',
      validUntil: null,
    });
    expect((await authed.get(RULES).expect(200)).body).toEqual([result.rule]);
  });

  it('lehnt Regeln für Einzeltermine und ungültige Eingaben ab', async () => {
    const single = singleService();
    await collections(t.db).services.insertOne(single);
    await authed.post(RULES, ruleBody(single._id)).expect(400);
    const svc = await insertGroup();
    await authed.post(RULES, { ...ruleBody(svc._id), startTime: '18:32' }).expect(400);
    await authed.post(RULES, { ...ruleBody(svc._id), weekdays: [] }).expect(400);
    await authed.post(RULES, { ...ruleBody(new ObjectId()) }).expect(404);
  });

  it('ändert und löscht eine Regel', async () => {
    const svc = await insertGroup({
      bookingRules: { minLeadMinutes: null, horizonDays: 14, changeDeadlineMinutes: null },
    });
    const created = courseRuleResultSchema.parse(
      (await authed.post(RULES, ruleBody(svc._id)).expect(201)).body,
    );
    const updated = courseRuleResultSchema.parse(
      (await authed.patch(`${RULES}/${created.rule.id}`, { startTime: '19:00' }).expect(200)).body,
    );
    expect(updated.rule.startTime).toBe('19:00');
    const sessions = await collections(t.db)
      .sessions.find({ status: { $ne: 'cancelled' } })
      .toArray();
    expect(sessions.every((s) => s.localStart.endsWith('T19:00'))).toBe(true);

    await authed
      .patch(`${RULES}/${created.rule.id}`, { serviceId: svc._id.toHexString() })
      .expect(400);
    const removed = await authed.delete(`${RULES}/${created.rule.id}`).expect(200);
    expect(removed.body).toEqual({ keptWithBookings: [] });
    expect(await collections(t.db).sessions.countDocuments()).toBe(0);
    await authed.get(`${RULES}/${created.rule.id}`).expect(404);
  });
});
