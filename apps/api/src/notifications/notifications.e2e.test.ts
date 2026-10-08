import { failedNotificationsResponseSchema } from '@fw-booking/shared';
import type { FailedNotificationsResponse } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../database/documents.js';
import type { BookingDocument, OutboxJobDocument } from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { groupBooking, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;

const URL = '/api/owner/notifications/failed';

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
    c.outboxJobs.deleteMany({}),
    c.bookings.deleteMany({}),
    c.services.deleteMany({}),
    c.auditEvents.deleteMany({}),
  ]);
});

const http = () => request(t.app.getHttpServer());
const get = (url: string) => http().get(url).set('Cookie', owner.cookie);
const post = (url: string) =>
  http().post(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send({});

let counter = 0;
function job(overrides: Partial<OutboxJobDocument> = {}): OutboxJobDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    type: 'booking_confirmation',
    status: 'failed',
    dedupeKey: `test:${String(++counter)}:${new ObjectId().toHexString()}`,
    bookingId: null,
    dueAt: now,
    attempts: 6,
    leaseUntil: null,
    leaseToken: null,
    lastErrorCategory: 'smtp_unavailable',
    failedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function bookingWithService(): Promise<BookingDocument> {
  const service = singleService({ title: 'Haarschnitt' });
  await collections(t.db).services.insertOne(service);
  const booking = groupBooking(new ObjectId(), service._id, {
    type: 'single',
    sessionId: null,
    participant: { name: 'Erika Mustermann', email: 'erika@example.test', phone: '030 123456' },
  });
  await collections(t.db).bookings.insertOne(booking);
  return booking;
}

const list = async (query = '') =>
  failedNotificationsResponseSchema.parse((await get(`${URL}${query}`).expect(200)).body);

describe('Zugriffsschutz', () => {
  it('ist nur für angemeldete Owner erreichbar', async () => {
    const doc = job();
    await collections(t.db).outboxJobs.insertOne(doc);
    await http().get(URL).expect(401);
    await http().post(`${URL}/${doc._id.toHexString()}/retry`).send({}).expect(401);
    await http()
      .post(`${URL}/${doc._id.toHexString()}/dismiss`)
      .set('Cookie', owner.cookie)
      .send({})
      .expect(403);
    expect((await collections(t.db).outboxJobs.findOne({ _id: doc._id }))?.status).toBe('failed');
  });
});

describe('Liste', () => {
  it('liefert fehlgeschlagene Jobs mit Typ, Zeitpunkt, Kategorie und Buchung', async () => {
    const booking = await bookingWithService();
    const failedAt = new Date('2026-10-08T12:00:00Z');
    await collections(t.db).outboxJobs.insertOne(
      job({
        bookingId: booking._id,
        lastErrorCategory: 'recipient_rejected',
        attempts: 1,
        failedAt,
      }),
    );
    const response = await get(URL).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = failedNotificationsResponseSchema.parse(response.body);
    expect(body).toMatchObject({ total: 1, retryingCount: 0 });
    expect(body.notifications[0]).toEqual({
      id: expect.any(String) as string,
      type: 'booking_confirmation',
      category: 'recipient_rejected',
      failedAt: '2026-10-08T12:00:00Z',
      attempts: 1,
      booking: {
        id: booking._id.toHexString(),
        serviceTitle: 'Haarschnitt',
        startsAt: booking.startsAt.toISOString().replace('.000Z', 'Z'),
        status: 'confirmed',
        participant: {
          name: 'Erika Mustermann',
          email: 'erika@example.test',
          phone: '030 123456',
        },
      },
    });
  });

  it('zeigt nur endgültig fehlgeschlagene, nicht ausgeblendete Jobs, neueste zuerst', async () => {
    const older = job({ failedAt: new Date('2026-10-01T08:00:00Z') });
    const newer = job({ failedAt: new Date('2026-10-05T08:00:00Z'), type: 'booking_reminder' });
    await collections(t.db).outboxJobs.insertMany([
      older,
      newer,
      job({ status: 'failed', dismissedAt: new Date() }),
      job({ status: 'sent', result: 'sent', completedAt: new Date(), failedAt: null }),
      job({ status: 'pending', attempts: 0, lastErrorCategory: null, failedAt: null }),
      // in Wiederholung
      job({ status: 'pending', attempts: 2, failedAt: null }),
      job({ status: 'processing', attempts: 3, failedAt: null }),
    ]);
    const body = await list();
    expect(body.notifications.map((n) => n.id)).toEqual([
      newer._id.toHexString(),
      older._id.toHexString(),
    ]);
    expect(body.total).toBe(2);
    expect(body.retryingCount).toBe(2);
  });

  it('filtert nach Zeitraum und Typ', async () => {
    await collections(t.db).outboxJobs.insertMany([
      job({ failedAt: new Date('2026-10-01T08:00:00Z') }),
      job({ failedAt: new Date('2026-10-05T08:00:00Z'), type: 'booking_reminder' }),
      job({ failedAt: new Date('2026-10-09T08:00:00Z'), type: 'owner_cancellation' }),
    ]);
    expect((await list('?from=2026-10-02&to=2026-10-08')).notifications).toHaveLength(1);
    expect((await list('?type=owner_cancellation')).notifications[0]?.type).toBe(
      'owner_cancellation',
    );
    await get(`${URL}?type=sms`).expect(400);
    await get(`${URL}?from=2026-10-09&to=2026-10-01`).expect(400);
  });

  it('gibt keine internen Felder, Fehlertexte oder unbekannten Kategorien heraus', async () => {
    await collections(t.db).outboxJobs.insertOne(
      job({
        lastErrorCategory: '535 Authentication failed for user mailer password geheim',
        leaseToken: 'lease-geheim',
        dedupeKey: 'booking_confirmation:intern',
        bookingId: new ObjectId(),
      }),
    );
    const response = await get(URL).expect(200);
    const text = JSON.stringify(response.body);
    for (const secret of ['geheim', 'lease', 'dedupe', 'intern', 'Authentication']) {
      expect(text).not.toContain(secret);
    }
    const body = response.body as FailedNotificationsResponse;
    expect(body.notifications[0]).toMatchObject({ category: 'unknown', booking: null });
  });

  it('begrenzt die Liste auf 200 Einträge und nennt die Gesamtzahl', async () => {
    await collections(t.db).outboxJobs.insertMany(Array.from({ length: 205 }, () => job()));
    const body = await list();
    expect(body.notifications).toHaveLength(200);
    expect(body.total).toBe(205);
  });
});

describe('Aktionen', () => {
  it('stellt einen fehlgeschlagenen Job erneut zur Verarbeitung', async () => {
    const doc = job({ lastErrorCategory: 'smtp_auth' });
    await collections(t.db).outboxJobs.insertOne(doc);
    const response = await post(`${URL}/${doc._id.toHexString()}/retry`).expect(200);
    expect(response.body).toEqual({
      id: doc._id.toHexString(),
      status: 'pending',
      alreadyDone: false,
    });
    const after = await collections(t.db).outboxJobs.findOne({ _id: doc._id });
    expect(after).toMatchObject({
      status: 'pending',
      attempts: 0,
      failedAt: null,
      lastErrorCategory: null,
      leaseToken: null,
    });
    expect(after?.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      await collections(t.db).auditEvents.findOne({ action: 'notification.retried' }),
    ).toMatchObject({ objectType: 'outboxJob', objectId: doc._id, actor: { type: 'owner' } });
    expect((await list()).total).toBe(0);

    // Zweiter Aufruf ändert nichts.
    const again = await post(`${URL}/${doc._id.toHexString()}/retry`).expect(200);
    expect(again.body).toMatchObject({ alreadyDone: true });
    expect(await collections(t.db).auditEvents.countDocuments()).toBe(1);
  });

  it('blendet einen fehlgeschlagenen Job aus, ohne ihn zu löschen', async () => {
    const doc = job();
    await collections(t.db).outboxJobs.insertOne(doc);
    const response = await post(`${URL}/${doc._id.toHexString()}/dismiss`).expect(200);
    expect(response.body).toMatchObject({ status: 'failed', alreadyDone: false });
    expect((await list()).total).toBe(0);
    expect(
      (await collections(t.db).outboxJobs.findOne({ _id: doc._id }))?.dismissedAt,
    ).toBeInstanceOf(Date);
    expect((await post(`${URL}/${doc._id.toHexString()}/dismiss`).expect(200)).body).toMatchObject({
      alreadyDone: true,
    });
    // Ausgeblendete Jobs werden nicht mehr erneut versendet.
    await post(`${URL}/${doc._id.toHexString()}/retry`).expect(409);
    expect(
      await collections(t.db).auditEvents.countDocuments({ action: 'notification.dismissed' }),
    ).toBe(1);
  });

  it('lehnt Aktionen für versendete und unbekannte Jobs ab', async () => {
    const sent = job({ status: 'sent', failedAt: null, completedAt: new Date() });
    await collections(t.db).outboxJobs.insertOne(sent);
    await post(`${URL}/${sent._id.toHexString()}/retry`).expect(409);
    await post(`${URL}/${sent._id.toHexString()}/dismiss`).expect(409);
    await post(`${URL}/${new ObjectId().toHexString()}/retry`).expect(404);
    await post(`${URL}/keine-id/retry`).expect(400);
    expect((await collections(t.db).outboxJobs.findOne({ _id: sent._id }))?.status).toBe('sent');
  });
});
