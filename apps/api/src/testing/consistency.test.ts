import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_ID, collections } from '../database/documents.js';
import type { BookingDocument, SessionDocument } from '../database/documents.js';
import { runMigrations } from '@fw-booking/db';
import { checkConsistency } from './consistency.js';
import { groupBooking } from './fixtures.js';
import { startReplSet } from './mongo.js';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const start = new Date('2026-12-01T09:00:00Z');
const end = new Date('2026-12-01T09:30:00Z');

beforeAll(async () => {
  replSet = await startReplSet();
  client = await MongoClient.connect(replSet.getUri());
  db = client.db('consistency_test');
  await runMigrations(db);
});

afterAll(async () => {
  await client.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(db);
  await Promise.all([
    c.sessions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
    c.outboxJobs.deleteMany({}),
  ]);
});

function units(refType: 'booking' | 'session', refId: ObjectId, from = start, to = end) {
  const result = [];
  for (let t = from.getTime(); t < to.getTime(); t += 5 * 60_000) {
    result.push({
      _id: new ObjectId(),
      resourceId: DEFAULT_RESOURCE_ID,
      unitStart: new Date(t),
      refType,
      refId,
    });
  }
  return result;
}

function job(bookingId: ObjectId) {
  return {
    _id: new ObjectId(),
    type: 'booking_confirmation' as const,
    status: 'pending' as const,
    dedupeKey: `booking_confirmation:${bookingId.toHexString()}`,
    bookingId,
    dueAt: start,
    attempts: 0,
    leaseUntil: null,
    lastErrorCategory: null,
    createdAt: start,
    updatedAt: start,
  };
}

function single(): BookingDocument {
  return {
    ...groupBooking(new ObjectId(), new ObjectId()),
    type: 'single',
    sessionId: null,
    startsAt: start,
    endsAt: end,
  };
}

function session(bookedCount: number): SessionDocument {
  return {
    _id: new ObjectId(),
    serviceId: new ObjectId(),
    ruleId: null,
    localStart: '2026-12-01T10:00',
    startsAt: start,
    endsAt: end,
    timeZone: 'Europe/Berlin',
    capacity: 5,
    bookedCount,
    status: 'scheduled',
    location: null,
    createdAt: start,
    updatedAt: start,
  };
}

describe('checkConsistency', () => {
  it('meldet nichts für konsistente Daten', async () => {
    const booking = single();
    await collections(db).bookings.insertOne(booking);
    await collections(db).resourceOccupancy.insertMany(units('booking', booking._id));
    await collections(db).outboxJobs.insertOne(job(booking._id));
    expect(await checkConsistency(db)).toEqual([]);
  });

  it('erkennt falsches bookedCount', async () => {
    const s = session(2);
    await collections(db).sessions.insertOne(s);
    await collections(db).resourceOccupancy.insertMany(units('session', s._id));
    const b = groupBooking(s._id, s.serviceId);
    await collections(db).bookings.insertOne(b);
    await collections(db).outboxJobs.insertOne(job(b._id));
    expect((await checkConsistency(db)).join()).toMatch(/bookedCount 2 ≠ 1/);
  });

  it('erkennt fehlende oder verwaiste Belegungen', async () => {
    const booking = single();
    await collections(db).bookings.insertOne(booking);
    await collections(db).outboxJobs.insertOne(job(booking._id));
    await collections(db).resourceOccupancy.insertMany(
      units(
        'booking',
        new ObjectId(),
        new Date('2026-12-01T11:00:00Z'),
        new Date('2026-12-01T11:10:00Z'),
      ),
    );
    const issues = (await checkConsistency(db)).join('\n');
    expect(issues).toMatch(/Belegung passt nicht zur Dauer/);
    expect(issues).toMatch(/Belegung ohne bestätigte Einzelbuchung/);
  });

  it('erkennt fehlende Bestätigungsaufträge', async () => {
    const booking = single();
    await collections(db).bookings.insertOne(booking);
    await collections(db).resourceOccupancy.insertMany(units('booking', booking._id));
    expect((await checkConsistency(db)).join()).toMatch(/0 Bestätigungsaufträge/);
  });
});
