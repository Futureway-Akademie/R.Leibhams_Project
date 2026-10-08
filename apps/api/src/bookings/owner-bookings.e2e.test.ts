import {
  addLocalDays,
  bookingSchema,
  localToday,
  ownerBookingCancelResultSchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
  selfServiceBookingSchema,
  sessionCancelResultSchema,
  sessionParticipantsSchema,
} from '@fw-booking/shared';
import type { Booking } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type {
  BookingDocument,
  SessionDocument,
  SingleServiceDocument,
} from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { checkConsistency } from '../testing/consistency.js';
import {
  groupBooking as groupBookingDoc,
  groupService,
  singleService,
} from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { ActionTokenService } from './action-token.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let tokens: ActionTokenService;
let owner: OwnerSession;
let base: string;

const TZ = 'Europe/Berlin';
const RULES = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };
const DATE = addLocalDays(localToday(TZ), 3);

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  tokens = t.app.get(ActionTokenService);
  owner = await loginAsOwner(t);
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
const get = (url: string) => http().get(url).set('Cookie', owner.cookie);
const post = (url: string, body: object = { confirm: true }) =>
  http().post(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body);
const patch = (url: string, body: object) =>
  http().patch(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body);

let counter = 0;
const participant = () => ({
  name: 'Erika Mustermann',
  email: `erika${String(++counter)}@example.test`,
  phone: '030 123456',
});

async function insertSession(capacity = 3, utcTime = '16:30'): Promise<SessionDocument> {
  const service = groupService({ bookingRules: RULES });
  await collections(t.db).services.insertOne(service);
  const startsAt = new Date(`${DATE}T${utcTime}:00Z`);
  const session: SessionDocument = {
    _id: new ObjectId(),
    serviceId: service._id,
    ruleId: null,
    localStart: `${DATE}T18:30`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 75 * 60_000),
    timeZone: TZ,
    capacity,
    bookedCount: 0,
    status: 'scheduled',
    location: 'Studio 1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await collections(t.db).sessions.insertOne(session);
  // Belegung wie beim Anlegen über die API (15 Einheiten à 5 Minuten).
  await collections(t.db).resourceOccupancy.insertMany(
    Array.from({ length: 15 }, (_, i) => ({
      _id: new ObjectId(),
      resourceId: 'default',
      unitStart: new Date(startsAt.getTime() + i * 5 * 60_000),
      refType: 'session' as const,
      refId: session._id,
    })),
  );
  return session;
}

async function bookSession(session: SessionDocument): Promise<BookingDocument> {
  const response = await http()
    .post(`${base}/bookings`)
    .send({
      type: 'group',
      sessionId: session._id.toHexString(),
      participant: participant(),
      idempotencyKey: `owner-cancel-${String(++counter)}-key-xyz`,
      privacyAccepted: true,
    })
    .expect(201);
  const id = (response.body as { bookingId: string }).bookingId;
  const booking = await collections(t.db).bookings.findOne({ _id: new ObjectId(id) });
  if (!booking) throw new Error('Buchung fehlt');
  return booking;
}

async function insertSingleService(): Promise<SingleServiceDocument> {
  const service = singleService({ bookingRules: RULES });
  await collections(t.db).services.insertOne(service);
  return service;
}

const slotsOf = async (service: SingleServiceDocument) =>
  publicSlotsResponseSchema
    .parse(
      (await http().get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)).body,
    )
    .slots.map((s) => s.startsAt);

async function bookSingle(service: SingleServiceDocument, startsAt: string) {
  const response = await http()
    .post(`${base}/bookings`)
    .send({
      type: 'single',
      serviceId: service._id.toHexString(),
      startsAt,
      participant: participant(),
      idempotencyKey: `owner-cancel-${String(++counter)}-key-xyz`,
      privacyAccepted: true,
    })
    .expect(201);
  const id = (response.body as { bookingId: string }).bookingId;
  const booking = await collections(t.db).bookings.findOne({ _id: new ObjectId(id) });
  if (!booking) throw new Error('Buchung fehlt');
  return booking;
}

const bookingUrl = (b: BookingDocument) => `/api/owner/bookings/${b._id.toHexString()}`;
const sessionUrl = (s: SessionDocument) => `/api/owner/sessions/${s._id.toHexString()}`;

describe('Zugriffsschutz', () => {
  it('liefert Buchungen und Teilnehmer nur an angemeldete Owner', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    await http().get('/api/owner/bookings').expect(401);
    await http().get(bookingUrl(booking)).expect(401);
    await http()
      .get(`${sessionUrl(session)}/participants`)
      .expect(401);
    await http()
      .post(`${bookingUrl(booking)}/cancel`)
      .send({ confirm: true })
      .expect(401);
    await http()
      .post(`${sessionUrl(session)}/cancel`)
      .send({ confirm: true })
      .expect(401);
    // Mit Sitzung, aber ohne CSRF-Token
    await http()
      .post(`${sessionUrl(session)}/cancel`)
      .set('Cookie', owner.cookie)
      .send({ confirm: true })
      .expect(403);
    expect((await collections(t.db).sessions.findOne({ _id: session._id }))?.status).toBe(
      'scheduled',
    );
  });

  it('gibt nach dem Logout keine Teilnehmerdaten mehr heraus', async () => {
    const session = await insertSession();
    await bookSession(session);
    const other = await loginAsOwner(t);
    await http()
      .get(`${sessionUrl(session)}/participants`)
      .set('Cookie', other.cookie)
      .expect(200);
    await http()
      .post('/api/auth/logout')
      .set('Cookie', other.cookie)
      .set('X-CSRF-Token', other.csrfToken)
      .send({})
      .expect(204);
    await http()
      .get(`${sessionUrl(session)}/participants`)
      .set('Cookie', other.cookie)
      .expect(401);
  });
});

describe('Buchungsübersicht', () => {
  it('listet Buchungen beider Terminarten mit Teilnehmerdaten, ohne Zwischenspeichern', async () => {
    const session = await insertSession();
    const group = await bookSession(session);
    const service = await insertSingleService();
    const [first] = await slotsOf(service);
    const single = await bookSingle(service, first ?? '');

    const response = await get(`/api/owner/bookings?from=${DATE}&to=${DATE}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const list = (response.body as unknown[]).map((b) => bookingSchema.parse(b));
    expect(list.map((b) => b.id)).toEqual([single._id.toHexString(), group._id.toHexString()]);
    expect(list[1]).toMatchObject({
      type: 'group',
      sessionId: session._id.toHexString(),
      status: 'confirmed',
      participant: { email: group.participant.email, phone: '030 123456' },
      ownerCancellationReason: null,
    });

    const groupOnly = (
      await get(
        `/api/owner/bookings?from=${DATE}&to=${DATE}&sessionId=${session._id.toHexString()}`,
      ).expect(200)
    ).body as Booking[];
    expect(groupOnly.map((b) => b.id)).toEqual([group._id.toHexString()]);
    const byService = (
      await get(
        `/api/owner/bookings?from=${DATE}&to=${DATE}&serviceId=${service._id.toHexString()}`,
      ).expect(200)
    ).body as Booking[];
    expect(byService.map((b) => b.id)).toEqual([single._id.toHexString()]);
  });

  it('nutzt standardmäßig 31 Tage ab heute und filtert nach Status', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    const service = groupService();
    await collections(t.db).services.insertOne(service);
    const later = new Date(Date.now() + 40 * 86_400_000);
    const past = new Date(Date.now() - 2 * 86_400_000);
    for (const startsAt of [later, past]) {
      await collections(t.db).bookings.insertOne(
        groupBookingDoc(new ObjectId(), service._id, {
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          participantEmailKey: `${startsAt.toISOString()}@example.test`,
        }),
      );
    }

    const all = (await get('/api/owner/bookings').expect(200)).body as Booking[];
    expect(all.map((b) => b.id)).toEqual([booking._id.toHexString()]);

    await post(`${bookingUrl(booking)}/cancel`).expect(200);
    const confirmed = (await get('/api/owner/bookings?status=confirmed').expect(200))
      .body as Booking[];
    expect(confirmed).toEqual([]);
    const cancelled = (await get('/api/owner/bookings?status=cancelled_by_owner').expect(200))
      .body as Booking[];
    expect(cancelled.map((b) => b.id)).toEqual([booking._id.toHexString()]);
  });

  it('lehnt ungültige Filter ab', async () => {
    await get('/api/owner/bookings?from=2026-12-02&to=2026-12-01').expect(400);
    await get('/api/owner/bookings?from=2026-01-01&to=2026-06-01').expect(400);
    await get('/api/owner/bookings?status=abgesagt').expect(400);
    await get('/api/owner/bookings?serviceId=123').expect(400);
  });

  it('liefert eine einzelne Buchung, unbekannte ergeben 404', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    const response = await get(bookingUrl(booking)).expect(200);
    expect(bookingSchema.parse(response.body).participant.name).toBe('Erika Mustermann');
    await get(`/api/owner/bookings/${new ObjectId().toHexString()}`).expect(404);
  });
});

describe('Teilnehmerliste', () => {
  it('zeigt alle Buchungen eines Kurstermins mit Status, älteste zuerst', async () => {
    const session = await insertSession();
    const a = await bookSession(session);
    const b = await bookSession(session);
    // b storniert selbst
    const token = await tokens.issue(b);
    await http()
      .post('/api/public/manage/cancel')
      .set('X-Booking-Token', token)
      .send({ confirm: true })
      .expect(200);
    const other = await insertSession(3, '18:00');
    await bookSession(other);

    const response = await get(`${sessionUrl(session)}/participants`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const list = sessionParticipantsSchema.parse(response.body);
    expect(list.session).toMatchObject({ id: session._id.toHexString(), bookedCount: 1 });
    expect(list.bookings.map((x) => [x.id, x.status])).toEqual([
      [a._id.toHexString(), 'confirmed'],
      [b._id.toHexString(), 'cancelled'],
    ]);
    expect(list.bookings[0]?.participant.email).toBe(a.participant.email);
  });

  it('meldet unbekannte Kurstermine mit 404', async () => {
    await get(`/api/owner/sessions/${new ObjectId().toHexString()}/participants`).expect(404);
    await get('/api/owner/sessions/kein-id/participants').expect(400);
  });
});

describe('Einzelne Buchung absagen', () => {
  it('sagt eine Kursbuchung ab: Status, Platz, Links, Auftrag, Audit', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    const token = await tokens.issue(booking);

    const response = await post(`${bookingUrl(booking)}/cancel`, {
      confirm: true,
      reason: '  Kursleitung erkrankt ',
    }).expect(200);
    const result = ownerBookingCancelResultSchema.parse(response.body);
    expect(result.alreadyCancelled).toBe(false);
    expect(result.booking).toMatchObject({
      status: 'cancelled_by_owner',
      ownerCancellationReason: 'Kursleitung erkrankt',
    });

    const c = collections(t.db);
    expect((await c.sessions.findOne({ _id: session._id }))?.bookedCount).toBe(0);
    expect(await c.actionTokens.countDocuments({ bookingId: booking._id, status: 'active' })).toBe(
      0,
    );
    const jobs = await c.outboxJobs.find({ type: 'owner_cancellation' }).toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ bookingId: booking._id, status: 'pending' });
    const audit = await c.auditEvents.findOne({ action: 'booking.cancelled_by_owner' });
    expect(audit).toMatchObject({ objectId: booking._id, actor: { type: 'owner' } });
    expect(JSON.stringify(audit)).not.toContain('erkrankt');
    expect(JSON.stringify(audit)).not.toContain(booking.participant.email);

    // Der Verwaltungslink zeigt den Status, erlaubt aber keine Aktion mehr.
    const view = selfServiceBookingSchema.parse(
      (await http().get('/api/public/manage').set('X-Booking-Token', token).expect(200)).body,
    );
    expect(view).toMatchObject({
      status: 'cancelled_by_owner',
      canCancel: false,
      canRebook: false,
    });
    await http()
      .post('/api/public/manage/cancel')
      .set('X-Booking-Token', token)
      .send({ confirm: true })
      .expect(409);

    // Der Platz ist wieder buchbar.
    await bookSession(session);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('sagt einen Einzeltermin ab und gibt die Zeit frei', async () => {
    const service = await insertSingleService();
    const [first] = await slotsOf(service);
    const booking = await bookSingle(service, first ?? '');
    expect(await slotsOf(service)).not.toContain(first);

    await post(`${bookingUrl(booking)}/cancel`).expect(200);
    expect(await collections(t.db).resourceOccupancy.countDocuments({ refId: booking._id })).toBe(
      0,
    );
    expect(await slotsOf(service)).toContain(first);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('ist wiederholbar ohne erneute Freigabe oder zweiten Auftrag', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    await bookSession(session);
    await post(`${bookingUrl(booking)}/cancel`).expect(200);
    const again = ownerBookingCancelResultSchema.parse(
      (await post(`${bookingUrl(booking)}/cancel`).expect(200)).body,
    );
    expect(again.alreadyCancelled).toBe(true);
    const c = collections(t.db);
    expect((await c.sessions.findOne({ _id: session._id }))?.bookedCount).toBe(1);
    expect(await c.outboxJobs.countDocuments({ type: 'owner_cancellation' })).toBe(1);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('gibt bei gleichzeitigen Absagen genau einmal frei', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    await bookSession(session);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(`${bookingUrl(booking)}/cancel`)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200));
    const fresh = responses.filter(
      (r) => !ownerBookingCancelResultSchema.parse(r.body).alreadyCancelled,
    );
    expect(fresh).toHaveLength(1);
    const c = collections(t.db);
    expect((await c.sessions.findOne({ _id: session._id }))?.bookedCount).toBe(1);
    expect(await c.outboxJobs.countDocuments({ type: 'owner_cancellation' })).toBe(1);
    expect(await c.auditEvents.countDocuments({ action: 'booking.cancelled_by_owner' })).toBe(1);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('Owner-Absage und Teilnehmer-Storno gleichzeitig: genau ein Übergang', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    const token = await tokens.issue(booking);
    const [ownerResponse, participantResponse] = await Promise.all([
      post(`${bookingUrl(booking)}/cancel`),
      http()
        .post('/api/public/manage/cancel')
        .set('X-Booking-Token', token)
        .send({ confirm: true }),
    ]);
    const status = (await collections(t.db).bookings.findOne({ _id: booking._id }))?.status;
    if (status === 'cancelled_by_owner') {
      expect(ownerResponse.status).toBe(200);
      expect(participantResponse.status).toBe(409);
    } else {
      expect(status).toBe('cancelled');
      expect(ownerResponse.status).toBe(409);
      expect(participantResponse.status).toBe(200);
    }
    expect((await collections(t.db).sessions.findOne({ _id: session._id }))?.bookedCount).toBe(0);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('verlangt eine Bestätigung und begrenzt die Begründung', async () => {
    const session = await insertSession();
    const booking = await bookSession(session);
    await post(`${bookingUrl(booking)}/cancel`, {}).expect(400);
    await post(`${bookingUrl(booking)}/cancel`, { confirm: true, reason: 'x'.repeat(501) }).expect(
      400,
    );
    await post(`${bookingUrl(booking)}/cancel`, { confirm: true, extra: 1 }).expect(400);
    const result = ownerBookingCancelResultSchema.parse(
      (await post(`${bookingUrl(booking)}/cancel`, { confirm: true, reason: '   ' }).expect(200))
        .body,
    );
    expect(result.booking.ownerCancellationReason).toBeNull();
  });

  it('lehnt stornierte, umgebuchte, vergangene und unbekannte Buchungen ab', async () => {
    const service = groupService();
    await collections(t.db).services.insertOne(service);
    const future = new Date(Date.now() + 86_400_000);
    const make = (overrides: Partial<BookingDocument>) =>
      groupBookingDoc(new ObjectId(), service._id, {
        startsAt: future,
        endsAt: new Date(future.getTime() + 3_600_000),
        participantEmailKey: `${new ObjectId().toHexString()}@example.test`,
        ...overrides,
      });
    const cancelled = make({ status: 'cancelled' });
    const rebooked = make({ status: 'rebooked', rebookedToBookingId: new ObjectId() });
    const pastStart = new Date(Date.now() - 2 * 3_600_000);
    const past = make({ startsAt: pastStart, endsAt: new Date(pastStart.getTime() + 3_600_000) });
    await collections(t.db).bookings.insertMany([cancelled, rebooked, past]);

    for (const [booking, code] of [
      [cancelled, 'not_cancellable'],
      [rebooked, 'not_cancellable'],
      [past, 'appointment_ended'],
    ] as const) {
      const response = await post(`${bookingUrl(booking)}/cancel`).expect(409);
      expect((response.body as { code: string }).code).toBe(code);
    }
    expect((await collections(t.db).bookings.findOne({ _id: past._id }))?.status).toBe('confirmed');
    await post(`/api/owner/bookings/${new ObjectId().toHexString()}/cancel`).expect(404);
    expect(await collections(t.db).outboxJobs.countDocuments({ type: 'owner_cancellation' })).toBe(
      0,
    );
  });
});

describe('Kurstermin absagen', () => {
  it('sagt Termin und alle aktiven Buchungen in einer Aktion ab', async () => {
    const session = await insertSession();
    const a = await bookSession(session);
    const b = await bookSession(session);
    const c3 = await bookSession(session);
    const tokenA = await tokens.issue(a);
    // c3 hat selbst storniert und bleibt storniert.
    const tokenC = await tokens.issue(c3);
    await http()
      .post('/api/public/manage/cancel')
      .set('X-Booking-Token', tokenC)
      .send({ confirm: true })
      .expect(200);

    const response = await post(`${sessionUrl(session)}/cancel`, {
      confirm: true,
      reason: 'Raum nicht verfügbar',
    }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const result = sessionCancelResultSchema.parse(response.body);
    expect(result).toMatchObject({
      cancelledBookings: 2,
      alreadyCancelled: false,
      session: { status: 'cancelled', bookedCount: 0, cancellationReason: 'Raum nicht verfügbar' },
    });

    const c = collections(t.db);
    const bookings = await c.bookings.find({ sessionId: session._id }).toArray();
    const statusOf = (doc: BookingDocument) => bookings.find((x) => x._id.equals(doc._id))?.status;
    expect([statusOf(a), statusOf(b), statusOf(c3)]).toEqual([
      'cancelled_by_owner',
      'cancelled_by_owner',
      'cancelled',
    ]);
    expect(bookings.find((x) => x._id.equals(a._id))?.ownerCancellationReason).toBe(
      'Raum nicht verfügbar',
    );
    // Ressource frei, Links entwertet, je abgesagter Buchung ein Auftrag
    expect(await c.resourceOccupancy.countDocuments({ refId: session._id })).toBe(0);
    expect(await c.actionTokens.findOne({ bookingId: a._id })).toMatchObject({
      status: 'revoked',
    });
    const jobs = await c.outboxJobs.find({ type: 'owner_cancellation' }).toArray();
    expect(jobs.map((j) => j.bookingId?.toHexString()).sort()).toEqual(
      [a._id.toHexString(), b._id.toHexString()].sort(),
    );
    // Audit: Termin und je Buchung ein Eintrag, ohne Begründung und Teilnehmerdaten
    const audit = await c.auditEvents
      .find({ action: { $in: ['session.cancelled', 'booking.cancelled_by_owner'] } })
      .toArray();
    expect(audit.map((e) => e.action).sort()).toEqual([
      'booking.cancelled_by_owner',
      'booking.cancelled_by_owner',
      'session.cancelled',
    ]);
    expect(audit.find((e) => e.action === 'session.cancelled')?.details).toEqual({
      cancelledBookings: 2,
      withReason: true,
    });
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain('verfügbar');
    expect(auditText).not.toContain(a.participant.email);

    // Verwaltungslink zeigt Absage; Termin weder öffentlich sichtbar noch buchbar.
    const view = selfServiceBookingSchema.parse(
      (await http().get('/api/public/manage').set('X-Booking-Token', tokenA).expect(200)).body,
    );
    expect(view.status).toBe('cancelled_by_owner');
    const publicSessions = publicSessionsResponseSchema.parse(
      (
        await http().get(
          `${base}/services/${session.serviceId.toHexString()}/sessions?from=${DATE}&to=${DATE}`,
        )
      ).body,
    );
    expect(publicSessions.sessions).toEqual([]);
    const late = await http()
      .post(`${base}/bookings`)
      .send({
        type: 'group',
        sessionId: session._id.toHexString(),
        participant: participant(),
        idempotencyKey: `owner-cancel-late-${String(++counter)}`,
        privacyAccepted: true,
      })
      .expect(409);
    expect((late.body as { code: string }).code).toBe('not_bookable');
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('ist nicht umkehrbar und wiederholbar ohne Wirkung', async () => {
    const session = await insertSession();
    await bookSession(session);
    await post(`${sessionUrl(session)}/cancel`).expect(200);
    const again = sessionCancelResultSchema.parse(
      (await post(`${sessionUrl(session)}/cancel`).expect(200)).body,
    );
    expect(again).toMatchObject({ alreadyCancelled: true, cancelledBookings: 0 });
    expect(again.session.cancellationReason).toBeNull();
    expect(await collections(t.db).outboxJobs.countDocuments({ type: 'owner_cancellation' })).toBe(
      1,
    );
    await patch(sessionUrl(session), { status: 'scheduled' }).expect(409);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('gibt die Zeit für Einzeltermine frei', async () => {
    const session = await insertSession();
    // Kurstermin in die Öffnungszeit legen (10:00 lokal), damit Slots betroffen sind.
    const startsAt = new Date(`${DATE}T08:00:00Z`);
    await collections(t.db).sessions.updateOne(
      { _id: session._id },
      { $set: { startsAt, endsAt: new Date(startsAt.getTime() + 75 * 60_000) } },
    );
    await collections(t.db).resourceOccupancy.deleteMany({ refId: session._id });
    await collections(t.db).resourceOccupancy.insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        _id: new ObjectId(),
        resourceId: 'default',
        unitStart: new Date(startsAt.getTime() + i * 5 * 60_000),
        refType: 'session' as const,
        refId: session._id,
      })),
    );
    const service = await insertSingleService();
    const tenOClock = startsAt.toISOString().replace('.000Z', 'Z');
    expect(await slotsOf(service)).not.toContain(tenOClock);
    await post(`${sessionUrl(session)}/cancel`).expect(200);
    expect(await slotsOf(service)).toContain(tenOClock);
  });

  it('sagt auch gesperrte Termine ohne Buchungen ab', async () => {
    const session = await insertSession();
    await patch(sessionUrl(session), { status: 'blocked' }).expect(200);
    const result = sessionCancelResultSchema.parse(
      (await post(`${sessionUrl(session)}/cancel`).expect(200)).body,
    );
    expect(result).toMatchObject({ cancelledBookings: 0, session: { status: 'cancelled' } });
    expect(
      await collections(t.db).auditEvents.countDocuments({ action: 'session.cancelled' }),
    ).toBe(1);
  });

  it('lehnt vergangene und unbekannte Termine ab und verlangt Bestätigung', async () => {
    const session = await insertSession();
    await post(`${sessionUrl(session)}/cancel`, {}).expect(400);
    const pastStart = new Date(Date.now() - 2 * 3_600_000);
    await collections(t.db).sessions.updateOne(
      { _id: session._id },
      { $set: { startsAt: pastStart, endsAt: new Date(pastStart.getTime() + 75 * 60_000) } },
    );
    const response = await post(`${sessionUrl(session)}/cancel`).expect(409);
    expect((response.body as { code: string }).code).toBe('appointment_ended');
    expect((await collections(t.db).sessions.findOne({ _id: session._id }))?.status).toBe(
      'scheduled',
    );
    await post(`/api/owner/sessions/${new ObjectId().toHexString()}/cancel`).expect(404);
  });
});

describe('Kapazität', () => {
  it('lehnt eine Kapazität unter den bestätigten Plätzen ab', async () => {
    const session = await insertSession(4);
    await bookSession(session);
    await bookSession(session);
    await bookSession(session);
    const response = await patch(sessionUrl(session), { capacity: 2 }).expect(409);
    expect((response.body as { message: string }).message).toMatch(/Kapazität/);
    expect((await collections(t.db).sessions.findOne({ _id: session._id }))?.capacity).toBe(4);
    await patch(sessionUrl(session), { capacity: 3 }).expect(200);
  });

  it('erlaubt nach einer Owner-Absage eine entsprechend kleinere Kapazität', async () => {
    const session = await insertSession(4);
    const a = await bookSession(session);
    await bookSession(session);
    await bookSession(session);
    await patch(sessionUrl(session), { capacity: 2 }).expect(409);
    await post(`${bookingUrl(a)}/cancel`).expect(200);
    await patch(sessionUrl(session), { capacity: 2 }).expect(200);
    expect(await checkConsistency(t.db)).toEqual([]);
  });
});
