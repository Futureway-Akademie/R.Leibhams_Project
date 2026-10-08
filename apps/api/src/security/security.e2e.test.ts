import { addLocalDays, localToday, publicSlotsResponseSchema } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { SingleServiceDocument } from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { groupBooking, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { RateLimitStore, clientKey } from './rate-limit.js';

const ALLOWED = 'https://kunde.test';
const TZ = 'Europe/Berlin';
const DATE = addLocalDays(localToday(TZ), 3);
const RULES = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };

let replSet: MongoMemoryReplSet;
/** Freigegebener Origin, Grenzen aus. */
let corsApp: TestApp;
/** Niedrige Grenzen je IP, eine Proxy-Stufe (X-Forwarded-For) für unterschiedliche Clients. */
let limitApp: TestApp;
/** Nur das Limit je E-Mail-Adresse. */
let emailApp: TestApp;

beforeAll(async () => {
  replSet = await startReplSet();
  const uri = replSet.getUri();
  [corsApp, limitApp, emailApp] = await Promise.all([
    createTestApp(uri, { cors: { allowedOrigins: [ALLOWED, 'https://www.kunde.test'] } }),
    createTestApp(uri, {
      trustProxy: 1,
      rateLimits: {
        read: { limit: 3, windowMs: 60_000 },
        booking: { limit: 2, windowMs: 600_000 },
        manageRead: { limit: 2, windowMs: 60_000 },
        manageWrite: { limit: 1, windowMs: 600_000 },
      },
    }),
    createTestApp(uri, { bookingsPerEmailPerHour: 2 }),
  ]);
});

afterAll(async () => {
  await Promise.all([corsApp.close(), limitApp.close(), emailApp.close()]);
  await replSet.stop();
});

async function calendarBase(t: TestApp): Promise<string> {
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  return `/api/public/calendars/${settings?.publicCalendarId ?? ''}`;
}

async function prepare(t: TestApp): Promise<SingleServiceDocument> {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.bookings.deleteMany({}),
    c.outboxJobs.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
    c.openingHours.deleteMany({}),
  ]);
  await c.openingHours.insertMany(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      _id: new ObjectId(),
      weekday,
      windows: [{ start: '09:00', end: '12:00' }],
    })),
  );
  const service = singleService({ bookingRules: RULES });
  await c.services.insertOne(service);
  return service;
}

let counter = 0;
const bookingBody = (service: SingleServiceDocument, startsAt: string, email?: string) => ({
  type: 'single',
  serviceId: service._id.toHexString(),
  startsAt,
  participant: {
    name: 'Erika Mustermann',
    email: email ?? `erika${String(++counter)}@example.test`,
    phone: '030 123456',
  },
  idempotencyKey: `security-${String(++counter)}-key-xyz`,
  privacyAccepted: true,
});

describe('CORS', () => {
  let base: string;
  let service: SingleServiceDocument;
  const http = () => request(corsApp.app.getHttpServer());

  beforeEach(async () => {
    service = await prepare(corsApp);
    base = await calendarBase(corsApp);
  });

  it('erlaubt freigegebene Origins mit passenden Headern', async () => {
    const response = await http().get(`${base}/services`).set('Origin', ALLOWED).expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(response.headers.vary).toMatch(/Origin/);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    const www = await http()
      .get(`${base}/services`)
      .set('Origin', 'https://www.kunde.test')
      .expect(200);
    expect(www.headers['access-control-allow-origin']).toBe('https://www.kunde.test');
  });

  it('beantwortet Preflights freigegebener Origins', async () => {
    const response = await http()
      .options(`${base}/bookings`)
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(response.headers).toMatchObject({
      'access-control-allow-origin': ALLOWED,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'Content-Type, X-Booking-Token',
      'access-control-max-age': '600',
    });
    await http()
      .options('/api/public/manage/cancel')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-booking-token')
      .expect(204);
  });

  it.each([
    'https://evil.test',
    'https://kunde.test.evil.test',
    'http://kunde.test',
    'https://kunde.test:8443',
    'null',
  ])('weist den Origin %s ab', async (origin) => {
    const get = await http().get(`${base}/services`).set('Origin', origin).expect(403);
    expect(get.body).toEqual({
      statusCode: 403,
      message: 'Diese Website ist für die Buchung nicht freigegeben',
      code: 'origin_not_allowed',
    });
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await http()
      .options(`${base}/bookings`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('löst mit fremdem Origin keine Buchung aus', async () => {
    const slots = publicSlotsResponseSchema.parse(
      (await http().get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)).body,
    ).slots;
    await http()
      .post(`${base}/bookings`)
      .set('Origin', 'https://evil.test')
      .send(bookingBody(service, slots[0]?.startsAt ?? ''))
      .expect(403);
    expect(await collections(corsApp.db).bookings.countDocuments()).toBe(0);
    await http()
      .post(`${base}/bookings`)
      .set('Origin', ALLOWED)
      .send(bookingBody(service, slots[0]?.startsAt ?? ''))
      .expect(201);
  });

  it('lässt Anfragen ohne Origin (Server, curl) unverändert zu', async () => {
    const response = await http().get(`${base}/services`).expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gibt Owner-Routen keine CORS-Freigabe', async () => {
    const owner = await http().get('/api/owner/services').set('Origin', ALLOWED).expect(401);
    expect(owner.headers['access-control-allow-origin']).toBeUndefined();
    const health = await request(corsApp.app.getHttpServer()).get('/health').set('Origin', ALLOWED);
    expect(health.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Ratenbegrenzung je IP', () => {
  let base: string;
  let service: SingleServiceDocument;
  const http = () => request(limitApp.app.getHttpServer());
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });

  beforeEach(async () => {
    service = await prepare(limitApp);
    base = await calendarBase(limitApp);
    limitApp.app.get(RateLimitStore).reset();
  });

  it('begrenzt lesende Anfragen und nennt die Wartezeit', async () => {
    for (let i = 0; i < 3; i++) {
      await http().get(`${base}/services`).set(from('203.0.113.1')).expect(200);
    }
    const blocked = await http().get(`${base}/services`).set(from('203.0.113.1')).expect(429);
    expect(blocked.body).toEqual({
      statusCode: 429,
      message: 'Zu viele Anfragen; bitte versuche es später erneut',
      code: 'rate_limited',
    });
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // Alle lesenden Endpunkte teilen sich die Grenze.
    await http()
      .get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)
      .set(from('203.0.113.1'))
      .expect(429);
    // Andere Clients sind nicht betroffen.
    await http().get(`${base}/services`).set(from('203.0.113.2')).expect(200);
  });

  it('zählt IPv6-Adressen je /64-Netz', async () => {
    for (let i = 1; i <= 3; i++) {
      await http()
        .get(`${base}/services`)
        .set(from(`2001:db8:1:2::${String(i)}`))
        .expect(200);
    }
    await http().get(`${base}/services`).set(from('2001:db8:1:2:ffff::9')).expect(429);
    await http().get(`${base}/services`).set(from('2001:db8:1:3::1')).expect(200);
  });

  it('begrenzt Buchungen getrennt und vor der Eingabeprüfung', async () => {
    const ip = from('203.0.113.10');
    await http().post(`${base}/bookings`).set(ip).send({}).expect(400);
    await http().post(`${base}/bookings`).set(ip).send({}).expect(400);
    await http().post(`${base}/bookings`).set(ip).send({}).expect(429);
    // Lesen bleibt für diesen Client möglich.
    await http().get(`${base}/services`).set(ip).expect(200);
  });

  it('begrenzt den Verwaltungslink lesend und schreibend', async () => {
    const ip = from('203.0.113.20');
    const token = 'a'.repeat(43);
    await http().get('/api/public/manage').set(ip).set('X-Booking-Token', token).expect(404);
    await http().get('/api/public/manage').set(ip).set('X-Booking-Token', token).expect(404);
    await http().get('/api/public/manage').set(ip).set('X-Booking-Token', token).expect(429);
    await http()
      .post('/api/public/manage/cancel')
      .set(ip)
      .set('X-Booking-Token', token)
      .send({ confirm: true })
      .expect(404);
    await http()
      .post('/api/public/manage/rebook')
      .set(ip)
      .set('X-Booking-Token', token)
      .send({ confirm: true })
      .expect(429);
  });

  it('begrenzt weder Healthcheck noch angemeldete Owner-Routen', async () => {
    const ip = from('203.0.113.30');
    for (let i = 0; i < 6; i++) await http().get('/health').set(ip).expect(200);
    const owner = await loginAsOwner(limitApp);
    for (let i = 0; i < 6; i++) {
      await http().get('/api/owner/services').set(ip).set('Cookie', owner.cookie).expect(200);
    }
  });
});

describe('Buchungslimit je E-Mail-Adresse', () => {
  let base: string;
  let service: SingleServiceDocument;
  let slots: string[];
  const http = () => request(emailApp.app.getHttpServer());

  beforeEach(async () => {
    service = await prepare(emailApp);
    base = await calendarBase(emailApp);
    slots = publicSlotsResponseSchema
      .parse(
        (await http().get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)).body,
      )
      .slots.map((s) => s.startsAt);
  });

  it('lehnt die dritte neue Buchung derselben Adresse innerhalb einer Stunde ab', async () => {
    const first = bookingBody(service, slots[0] ?? '', 'vielbucher@example.test');
    await http().post(`${base}/bookings`).send(first).expect(201);
    await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[6] ?? '', 'Vielbucher@Example.test'))
      .expect(201);
    const third = await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[12] ?? '', 'vielbucher@example.test'))
      .expect(429);
    expect(third.body).toMatchObject({ statusCode: 429, code: 'too_many_bookings' });
    expect(JSON.stringify(third.body)).not.toContain('vielbucher');
    // Wiederholung einer früheren Anfrage bleibt möglich, andere Adressen sind nicht betroffen.
    await http().post(`${base}/bookings`).send(first).expect(200);
    await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[12] ?? '', 'andere@example.test'))
      .expect(201);
    expect(
      await collections(emailApp.db).bookings.countDocuments({
        participantEmailKey: 'vielbucher@example.test',
      }),
    ).toBe(2);
  });

  it('zählt ältere und durch Umbuchung entstandene Buchungen nicht', async () => {
    const email = 'stamm@example.test';
    const old = new Date(Date.now() - 61 * 60_000);
    await collections(emailApp.db).bookings.insertMany([
      groupBooking(new ObjectId(), service._id, {
        participantEmailKey: email,
        createdAt: old,
      }),
      groupBooking(new ObjectId(), service._id, {
        participantEmailKey: email,
        idempotencyKey: `rebook-${new ObjectId().toHexString()}`,
        createdAt: new Date(),
      }),
    ]);
    await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[0] ?? '', email))
      .expect(201);
    await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[6] ?? '', email))
      .expect(201);
    await http()
      .post(`${base}/bookings`)
      .send(bookingBody(service, slots[12] ?? '', email))
      .expect(429);
  });
});

describe('Ungültige Eingaben', () => {
  let base: string;
  const http = () => request(corsApp.app.getHttpServer());

  beforeEach(async () => {
    await prepare(corsApp);
    base = await calendarBase(corsApp);
  });

  it('beantwortet fehlerhaftes JSON ohne Parsermeldung', async () => {
    const response = await http()
      .post(`${base}/bookings`)
      .set('Content-Type', 'application/json')
      .send('{"type":')
      .expect(400);
    expect(response.body).toEqual({ statusCode: 400, message: 'Ungültige Eingabe' });
  });

  it('lehnt zu große Anfragen ab', async () => {
    const response = await http()
      .post(`${base}/bookings`)
      .send({ padding: 'x'.repeat(20_000) })
      .expect(413);
    expect(response.body).toEqual({ statusCode: 413, message: 'Die Anfrage ist zu groß' });
  });

  it('lehnt andere Inhaltstypen ab', async () => {
    await http()
      .post(`${base}/bookings`)
      .set('Content-Type', 'text/plain')
      .send('type=single')
      .expect(415);
  });

  it('nennt bei Validierungsfehlern nur Feld und Regel, nie die Werte', async () => {
    const secret = 'geheim-0815-<script>';
    const response = await http()
      .post(`${base}/bookings`)
      .send({
        type: 'single',
        serviceId: secret,
        startsAt: secret,
        participant: { name: secret, email: secret, phone: secret },
        idempotencyKey: secret,
        privacyAccepted: true,
      })
      .expect(400);
    const body = response.body as { message: string; issues: { path: string }[] };
    expect(body.message).toBe('Ungültige Eingabe');
    expect(body.issues.map((i) => i.path)).toContain('participant.email');
    expect(JSON.stringify(body)).not.toContain('geheim');
    expect(JSON.stringify(body)).not.toMatch(/stack|node_modules|\.ts:/);
  });

  it('lehnt mehrfach übergebene Parameter und unbekannte Felder ab', async () => {
    await http()
      .get(`${base}/services/${new ObjectId().toHexString()}/slots?date=a&date=b`)
      .expect(400);
    await http().post(`${base}/bookings`).send({ type: 'single', unexpected: true }).expect(400);
  });

  it('beantwortet unbekannte Routen ohne Pfadangabe', async () => {
    const response = await http().get('/api/public/gibt-es-nicht/../../etc').expect(404);
    expect(response.body).toEqual({ statusCode: 404, message: 'Nicht gefunden' });
    const post = await http().post('/api/nichts').send({}).expect(404);
    expect(post.body).toEqual({ statusCode: 404, message: 'Nicht gefunden' });
    // Fachliche 404-Antworten bleiben aussagekräftig.
    const unknownService = await http()
      .get(`${base}/services/${new ObjectId().toHexString()}/slots?date=${DATE}`)
      .expect(404);
    expect((unknownService.body as { message: string }).message).not.toBe('Nicht gefunden');
  });
});

describe('clientKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('%s → %s', (ip, key) => {
    expect(clientKey(ip)).toBe(key);
  });
});

describe('RateLimitStore', () => {
  it('öffnet nach Ablauf des Fensters ein neues', () => {
    const store = new RateLimitStore();
    const rule = { limit: 2, windowMs: 1000 };
    expect(store.hit('k', rule, 0)).toBeNull();
    expect(store.hit('k', rule, 100)).toBeNull();
    expect(store.hit('k', rule, 200)).toEqual({ retryAfterSeconds: 1 });
    expect(store.hit('k', rule, 1000)).toBeNull();
    store.sweep(5000);
    expect(store.size).toBe(0);
    store.onModuleDestroy();
  });
});
