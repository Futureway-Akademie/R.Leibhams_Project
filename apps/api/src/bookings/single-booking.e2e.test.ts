import {
  bookingConfirmationSchema,
  bookingErrorResponseSchema,
  publicSlotsResponseSchema,
} from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_ID, SETTINGS_ID, collections } from '../database/documents.js';
import type { SingleServiceDocument } from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let base: string;

const RULES = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };
/** Ein Tag in drei Tagen, lokal 09:00–12:00 geöffnet (jeder Wochentag). */
const DATE = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
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
    c.openingHours.deleteMany({}),
    c.availabilityExceptions.deleteMany({}),
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
let keyCounter = 0;
const newKey = () => `single-key-${String(Date.now())}-${String(++keyCounter)}`;

async function insertService(overrides: Partial<SingleServiceDocument> = {}) {
  const svc = singleService({ bookingRules: RULES, ...overrides });
  await collections(t.db).services.insertOne(svc);
  return svc;
}

async function offered(serviceId: ObjectId): Promise<string[]> {
  const response = await http()
    .get(`${base}/services/${serviceId.toHexString()}/slots?date=${DATE}`)
    .expect(200);
  return publicSlotsResponseSchema.parse(response.body).slots.map((s) => s.startsAt);
}

function body(serviceId: ObjectId, startsAt: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'single',
    serviceId: serviceId.toHexString(),
    startsAt,
    participant: { name: 'Max Muster', email: 'Max@Example.test', phone: '0170 1234567' },
    idempotencyKey: newKey(),
    privacyAccepted: true,
    ...overrides,
  };
}

const book = (payload: object) => http().post(`${base}/bookings`).send(payload);
const code = (response: request.Response) => bookingErrorResponseSchema.parse(response.body).code;

async function counts() {
  const c = collections(t.db);
  return {
    bookings: await c.bookings.countDocuments(),
    units: await c.resourceOccupancy.countDocuments(),
    outbox: await c.outboxJobs.countDocuments(),
  };
}

describe('Erfolgreiche Einzeltermin-Buchung', () => {
  it('belegt genau die Dauer und legt Buchung, Auftrag und Audit an', async () => {
    const svc = await insertService({ durationMinutes: 30 });
    const [first] = await offered(svc._id);
    if (!first) throw new Error('keine Startzeit');

    const response = await book(body(svc._id, first)).expect(201);
    const confirmation = bookingConfirmationSchema.parse(response.body);
    expect(confirmation).toMatchObject({ status: 'confirmed', startsAt: first });
    expect(Date.parse(confirmation.endsAt) - Date.parse(first)).toBe(30 * 60_000);

    expect(await counts()).toEqual({ bookings: 1, units: 6, outbox: 1 });
    const booking = await collections(t.db).bookings.findOne();
    expect(booking).toMatchObject({
      type: 'single',
      sessionId: null,
      status: 'confirmed',
      participantEmailKey: 'max@example.test',
      timeZone: 'Europe/Berlin',
    });
    const units = await collections(t.db)
      .resourceOccupancy.find({}, { sort: { unitStart: 1 } })
      .toArray();
    expect(units[0]?.unitStart.toISOString()).toBe(new Date(first).toISOString());
    expect(units.every((u) => u.refType === 'booking' && u.refId.equals(booking?._id))).toBe(true);

    const audit = await collections(t.db).auditEvents.findOne({ action: 'booking.created' });
    expect(audit?.details).toMatchObject({ type: 'single' });
    expect(JSON.stringify(audit)).not.toMatch(/Max|example\.test|0170 1234567/);
  });

  it('nimmt die gebuchte Zeit aus den angebotenen Startzeiten', async () => {
    const svc = await insertService({ durationMinutes: 30 });
    const before = await offered(svc._id);
    const chosen = before[6]; // 09:30 Ortszeit
    if (!chosen) throw new Error('keine Startzeit');
    await book(body(svc._id, chosen)).expect(201);
    const after = await offered(svc._id);
    // Alle Startzeiten, deren 30 Minuten 09:30–10:00 berühren (09:05 … 09:55), entfallen.
    expect(before.length - after.length).toBe(11);
    expect(after).not.toContain(chosen);
  });

  it('erlaubt mehrere Einzeltermine mit derselben E-Mail-Adresse', async () => {
    const svc = await insertService();
    const slots = await offered(svc._id);
    await book(body(svc._id, slots[0] ?? '')).expect(201);
    await book(body(svc._id, slots[12] ?? '')).expect(201);
    expect((await counts()).bookings).toBe(2);
  });
});

describe('Idempotenz', () => {
  it('liefert bei Wiederholung dieselbe Buchung, ohne erneut zu belegen', async () => {
    const svc = await insertService();
    const [first] = await offered(svc._id);
    const payload = body(svc._id, first ?? '');
    const a = await book(payload).expect(201);
    const b = await book(payload).expect(200);
    expect(b.body).toEqual(a.body);
    expect(await counts()).toEqual({ bookings: 1, units: 6, outbox: 1 });
  });

  it('lehnt denselben Schlüssel mit anderer Startzeit ab', async () => {
    const svc = await insertService();
    const slots = await offered(svc._id);
    const payload = body(svc._id, slots[0] ?? '');
    await book(payload).expect(201);
    const response = await book({ ...payload, startsAt: slots[12] }).expect(409);
    expect(code(response)).toBe('idempotency_conflict');
  });
});

describe('Konflikte', () => {
  it('meldet belegte Zeiten als slot_taken und speichert nichts', async () => {
    const svc = await insertService();
    const [first] = await offered(svc._id);
    await book(body(svc._id, first ?? '')).expect(201);
    const before = await counts();
    const response = await book(
      body(svc._id, first ?? '', {
        participant: { name: 'Erika', email: 'erika@example.test', phone: '030 123456' },
      }),
    ).expect(409);
    expect(code(response)).toBe('slot_taken');
    expect(await counts()).toEqual(before);
  });

  it('meldet Überschneidung mit einem anderen Angebot als slot_taken', async () => {
    const short = await insertService({ title: 'Bart', durationMinutes: 20 });
    const long = await insertService({ title: 'Färben', durationMinutes: 90 });
    const longSlots = await offered(long._id);
    const shortSlots = await offered(short._id);
    await book(body(long._id, longSlots[0] ?? '')).expect(201); // 09:00–10:30
    const response = await book(body(short._id, shortSlots[12] ?? '')).expect(409); // 10:00
    expect(code(response)).toBe('slot_taken');
  });

  it('wird durch Kurstermine blockiert (gemeinsame Ressource)', async () => {
    const svc = await insertService();
    const [first] = await offered(svc._id);
    const course = groupService();
    await collections(t.db).services.insertOne(course);
    const start = new Date(first ?? '');
    await collections(t.db).resourceOccupancy.insertMany(
      Array.from({ length: 12 }, (_, i) => ({
        _id: new ObjectId(),
        resourceId: DEFAULT_RESOURCE_ID,
        unitStart: new Date(start.getTime() + i * 5 * 60_000),
        refType: 'session' as const,
        refId: new ObjectId(),
      })),
    );
    expect(code(await book(body(svc._id, first ?? '')).expect(409))).toBe('slot_taken');
  });

  it('vergibt bei 20 gleichzeitigen Anfragen dieselbe Zeit genau einmal', async () => {
    const svc = await insertService();
    const [first] = await offered(svc._id);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        book(
          body(svc._id, first ?? '', {
            participant: {
              name: `Person ${String(i)}`,
              email: `p${String(i)}@example.test`,
              phone: '030 123456',
            },
          }),
        ),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = responses.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(19);
    expect(rejected.every((r) => code(r) === 'slot_taken')).toBe(true);
    expect(await counts()).toEqual({ bookings: 1, units: 6, outbox: 1 });
  });

  it('vergibt bei gleichzeitigen Anfragen auf überlappende Zeiten verschiedener Angebote nur eine', async () => {
    const short = await insertService({ title: 'Bart', durationMinutes: 20 });
    const long = await insertService({ title: 'Färben', durationMinutes: 90 });
    const shortSlots = await offered(short._id);
    const longSlots = await offered(long._id);
    const responses = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) =>
        book(
          body(long._id, longSlots[0] ?? '', {
            participant: {
              name: `L ${String(i)}`,
              email: `l${String(i)}@example.test`,
              phone: '030 1234',
            },
          }),
        ),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        book(
          body(short._id, shortSlots[6] ?? '', {
            participant: {
              name: `S ${String(i)}`,
              email: `s${String(i)}@example.test`,
              phone: '030 1234',
            },
          }),
        ),
      ),
    ]);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409).every((r) => code(r) === 'slot_taken')).toBe(
      true,
    );
    const { bookings, units } = await counts();
    expect(bookings).toBe(1);
    expect([4, 18]).toContain(units);
  });
});

describe('Nicht buchbare Zeiten', () => {
  it.each([
    ['außerhalb der Öffnungszeit', 'T13:00:00'],
    ['nicht im 5-Minuten-Raster', 'T09:02:00'],
  ])('lehnt ab: %s', async (_label, time) => {
    const svc = await insertService();
    const local = `${DATE}${time}`;
    // Ortszeit (Europe/Berlin) in UTC: Offset aus einer angebotenen Startzeit ableiten.
    const [first] = await offered(svc._id);
    const offsetMs = Date.parse(first ?? '') - Date.parse(`${DATE}T09:00:00Z`);
    const startsAt = new Date(Date.parse(`${local}Z`) + offsetMs)
      .toISOString()
      .replace('.000Z', 'Z');
    const response = await book(body(svc._id, startsAt)).expect(409);
    expect(code(response)).toBe('not_bookable');
    expect((await counts()).bookings).toBe(0);
  });

  it('lehnt Startzeiten innerhalb des Mindestvorlaufs ab', async () => {
    const svc = await insertService({
      bookingRules: { minLeadMinutes: 5 * 24 * 60, horizonDays: 30, changeDeadlineMinutes: null },
    });
    const soon = new Date(Date.now() + 3 * 86_400_000);
    soon.setUTCHours(9, 0, 0, 0);
    const response = await book(body(svc._id, soon.toISOString().replace('.000Z', 'Z'))).expect(
      409,
    );
    expect(code(response)).toBe('not_bookable');
  });

  it('liefert 404 für unbekannte, deaktivierte und Gruppenkurs-Angebote', async () => {
    const inactive = await insertService({ active: false });
    const course = groupService();
    await collections(t.db).services.insertOne(course);
    const startsAt = `${DATE}T08:00:00Z`;
    await book(body(new ObjectId(), startsAt)).expect(404);
    await book(body(inactive._id, startsAt)).expect(404);
    await book(body(course._id, startsAt)).expect(404);
  });

  it('verlangt die Bestätigung der Datenschutzhinweise', async () => {
    const svc = await insertService();
    const [first] = await offered(svc._id);
    await book(body(svc._id, first ?? '', { privacyAccepted: false })).expect(400);
    expect((await counts()).bookings).toBe(0);
  });
});
