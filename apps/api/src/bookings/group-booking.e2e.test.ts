import { bookingConfirmationSchema, bookingErrorResponseSchema } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { GroupServiceDocument, SessionDocument } from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { groupService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let url: string;

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  url = `/api/public/calendars/${settings?.publicCalendarId ?? ''}/bookings`;
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
  ]);
});

const http = () => request(t.app.getHttpServer());
let keyCounter = 0;
const newKey = () => `test-key-${String(Date.now())}-${String(++keyCounter)}`;

async function setup(
  sessionOverrides: Partial<SessionDocument> = {},
  serviceOverrides: Partial<GroupServiceDocument> = {},
) {
  const service = groupService({
    bookingRules: { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null },
    ...serviceOverrides,
  });
  await collections(t.db).services.insertOne(service);
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  startsAt.setUTCHours(16, 30, 0, 0);
  const session: SessionDocument = {
    _id: new ObjectId(),
    serviceId: service._id,
    ruleId: null,
    localStart: '2026-01-01T18:30',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 75 * 60_000),
    timeZone: 'Europe/Berlin',
    capacity: 3,
    bookedCount: 0,
    status: 'scheduled',
    location: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...sessionOverrides,
  };
  await collections(t.db).sessions.insertOne(session);
  return { service, session };
}

function body(sessionId: ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    type: 'group',
    sessionId: sessionId.toHexString(),
    participant: { name: 'Erika Mustermann', email: 'Erika@Example.test', phone: '030 123456' },
    idempotencyKey: newKey(),
    privacyAccepted: true,
    ...overrides,
  };
}

const book = (payload: object) => http().post(url).send(payload);

async function counts(sessionId: ObjectId) {
  const c = collections(t.db);
  return {
    bookedCount: (await c.sessions.findOne({ _id: sessionId }))?.bookedCount,
    bookings: await c.bookings.countDocuments({ sessionId }),
    outbox: await c.outboxJobs.countDocuments(),
  };
}

function errorCode(response: request.Response) {
  return bookingErrorResponseSchema.parse(response.body).code;
}

describe('Erfolgreiche Kursbuchung', () => {
  it('belegt einen Platz und legt Buchung, Bestätigungsauftrag und Audit an', async () => {
    const { service, session } = await setup();
    const response = await book(body(session._id)).expect(201);
    const confirmation = bookingConfirmationSchema.parse(response.body);
    expect(confirmation).toMatchObject({
      status: 'confirmed',
      serviceTitle: service.title,
      startsAt: session.startsAt.toISOString().replace('.000Z', 'Z'),
      timeZone: 'Europe/Berlin',
    });
    expect(response.headers['cache-control']).toBe('no-store');

    expect(await counts(session._id)).toEqual({ bookedCount: 1, bookings: 1, outbox: 1 });
    const booking = await collections(t.db).bookings.findOne({ sessionId: session._id });
    expect(booking).toMatchObject({
      status: 'confirmed',
      type: 'group',
      participantEmailKey: 'erika@example.test',
      participant: { email: 'Erika@Example.test' },
    });
    expect(booking?.privacyAcceptedAt).toBeInstanceOf(Date);
    expect(booking?._id.toHexString()).toBe(confirmation.bookingId);

    const job = await collections(t.db).outboxJobs.findOne();
    expect(job).toMatchObject({
      type: 'booking_confirmation',
      status: 'pending',
      attempts: 0,
      dedupeKey: `booking_confirmation:${confirmation.bookingId}`,
    });

    const audit = await collections(t.db).auditEvents.findOne({ action: 'booking.created' });
    expect(audit?.actor).toEqual({ type: 'participant', id: null });
    expect(JSON.stringify(audit)).not.toMatch(/Erika|example\.test|030/);
  });

  it('enthält weder Teilnehmerdaten noch Verwaltungslink in der Antwort', async () => {
    const { session } = await setup();
    const response = await book(body(session._id)).expect(201);
    expect(JSON.stringify(response.body)).not.toMatch(/Erika|example\.test|030|token/i);
  });
});

describe('Idempotenz', () => {
  it('liefert bei Wiederholung dieselbe Buchung, ohne erneut zu buchen', async () => {
    const { session } = await setup();
    const payload = body(session._id);
    const first = await book(payload).expect(201);
    const second = await book(payload).expect(200);
    expect(second.body).toEqual(first.body);
    expect(await counts(session._id)).toEqual({ bookedCount: 1, bookings: 1, outbox: 1 });
  });

  it('lehnt denselben Schlüssel mit anderen Daten ab', async () => {
    const { session } = await setup();
    const other = await setup();
    const payload = body(session._id);
    await book(payload).expect(201);
    const differentEmail = await book({
      ...payload,
      participant: { ...payload.participant, email: 'jemand@example.test' },
    }).expect(409);
    expect(errorCode(differentEmail)).toBe('idempotency_conflict');
    const differentSession = await book({
      ...payload,
      sessionId: other.session._id.toHexString(),
    }).expect(409);
    expect(errorCode(differentSession)).toBe('idempotency_conflict');
  });

  it('erzeugt bei gleichzeitigen Wiederholungen nur eine Buchung', async () => {
    const { session } = await setup();
    const payload = body(session._id);
    const responses = await Promise.all(Array.from({ length: 5 }, () => book(payload)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => (r.body as { bookingId: string }).bookingId)).size).toBe(1);
    expect(await counts(session._id)).toEqual({ bookedCount: 1, bookings: 1, outbox: 1 });
  });
});

describe('Kapazität', () => {
  it('meldet ausgebuchte Termine und speichert nichts', async () => {
    const { session } = await setup({ capacity: 2, bookedCount: 2 });
    const response = await book(body(session._id)).expect(409);
    expect(errorCode(response)).toBe('session_full');
    expect(await counts(session._id)).toEqual({ bookedCount: 2, bookings: 0, outbox: 0 });
  });

  it('vergibt bei gleichzeitigen Anfragen genau die freien Plätze', async () => {
    const { session } = await setup({ capacity: 3 });
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        book(
          body(session._id, {
            participant: {
              name: `Teilnehmer ${String(i)}`,
              email: `person${String(i)}@example.test`,
              phone: '030 123456',
            },
          }),
        ),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(17);
    expect(
      responses.filter((r) => r.status === 409).every((r) => errorCode(r) === 'session_full'),
    ).toBe(true);
    expect(await counts(session._id)).toEqual({ bookedCount: 3, bookings: 3, outbox: 3 });
  });
});

describe('Eine aktive Buchung je E-Mail', () => {
  it('lehnt eine zweite Buchung derselben E-Mail ab und rollt die Platzbelegung zurück', async () => {
    const { session } = await setup();
    await book(body(session._id)).expect(201);
    const again = await book(
      body(session._id, {
        participant: { name: 'Erika M.', email: 'erika@example.TEST', phone: '0170 1234567' },
      }),
    ).expect(409);
    expect(errorCode(again)).toBe('already_booked');
    expect(await counts(session._id)).toEqual({ bookedCount: 1, bookings: 1, outbox: 1 });
  });

  it('erlaubt eine neue Buchung nach Storno', async () => {
    const { session } = await setup();
    await book(body(session._id)).expect(201);
    await collections(t.db).bookings.updateMany({}, { $set: { status: 'cancelled' } });
    await collections(t.db).sessions.updateOne({ _id: session._id }, { $set: { bookedCount: 0 } });
    await book(body(session._id)).expect(201);
  });
});

describe('Nicht buchbare Termine', () => {
  it.each([
    ['gesperrt', { status: 'blocked' as const }],
    ['abgesagt', { status: 'cancelled' as const }],
    ['innerhalb des Mindestvorlaufs', { startsAt: new Date(Date.now() + 30 * 60_000) }],
    ['jenseits des Horizonts', { startsAt: new Date(Date.now() + 40 * 86_400_000) }],
  ])('lehnt ab: %s', async (_label, overrides) => {
    const startsAt = 'startsAt' in overrides ? overrides.startsAt : undefined;
    const { session } = await setup({
      ...overrides,
      ...(startsAt ? { endsAt: new Date(startsAt.getTime() + 75 * 60_000) } : {}),
    });
    const response = await book(body(session._id)).expect(409);
    expect(errorCode(response)).toBe('not_bookable');
    expect(await counts(session._id)).toMatchObject({ bookings: 0, outbox: 0 });
  });

  it('liefert 404 für unbekannte Termine und deaktivierte Kurse', async () => {
    await book(body(new ObjectId())).expect(404);
    const { session } = await setup({}, { active: false });
    await book(body(session._id)).expect(404);
  });

  it('liefert 404 für unbekannte Kalender', async () => {
    const { session } = await setup();
    await http()
      .post('/api/public/calendars/cal_unbekannt1234567890/bookings')
      .send(body(session._id))
      .expect(404);
  });
});

describe('Eingaben', () => {
  it('verlangt die Bestätigung der Datenschutzhinweise', async () => {
    const { session } = await setup();
    await book(body(session._id, { privacyAccepted: false })).expect(400);
    const withoutConsent: Record<string, unknown> = body(session._id);
    delete withoutConsent.privacyAccepted;
    await book(withoutConsent).expect(400);
    expect(await counts(session._id)).toMatchObject({ bookings: 0 });
  });

  it('validiert Teilnehmerdaten ohne sie zurückzugeben', async () => {
    const { session } = await setup();
    const response = await book(
      body(session._id, {
        participant: { name: 'X', email: 'geheim@', phone: '0301234567' },
      }),
    ).expect(400);
    expect(JSON.stringify(response.body)).not.toMatch(/geheim|0301234567/);
  });

  it('verlangt JSON und benötigt keine Anmeldung', async () => {
    const { session } = await setup();
    await http().post(url).type('form').send({ sessionId: session._id.toHexString() }).expect(415);
  });

  it('nimmt Einzeltermine erst mit task-2-10 an', async () => {
    await book({
      type: 'single',
      serviceId: new ObjectId().toHexString(),
      startsAt: '2026-12-01T09:00:00Z',
      participant: { name: 'Max Muster', email: 'max@example.test', phone: '030 123456' },
      idempotencyKey: newKey(),
      privacyAccepted: true,
    }).expect(400);
  });
});
