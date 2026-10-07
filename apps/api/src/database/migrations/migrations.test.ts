import { MongoClient, MongoServerError, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startReplSet } from '../../testing/mongo.js';
import { COLLECTIONS, SETTINGS_ID, collections } from '../documents.js';
import type { BookingDocument, SessionDocument } from '../documents.js';
import { MIGRATIONS_COLLECTION, MigrationError, runMigrations } from './runner.js';
import type { Migration } from './migration.js';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let dbCounter = 0;

beforeAll(async () => {
  replSet = await startReplSet();
  client = await MongoClient.connect(replSet.getUri());
});

afterAll(async () => {
  await client.close();
  await replSet.stop();
});

function freshDb(): Db {
  dbCounter += 1;
  return client.db(`migrations_test_${String(dbCounter)}`);
}

type IndexSummary = Record<string, { unique: boolean; key: Record<string, unknown> }>;

async function indexNames(db: Db, collection: string): Promise<IndexSummary> {
  const summary: IndexSummary = {};
  for (const index of await db.collection(collection).indexes()) {
    summary[String(index.name)] = {
      unique: index.unique === true,
      key: index.key,
    };
  }
  return summary;
}

describe('runMigrations', () => {
  it('wendet alle Migrationen an und vermerkt sie', async () => {
    const db = freshDb();
    const result = await runMigrations(db);
    expect(result).toEqual({
      applied: [
        '001-initial',
        '002-auth',
        '003-service-order',
        '004-public-calendar',
        '005-booking-privacy',
      ],
      alreadyApplied: [],
    });
    const records = await db.collection(MIGRATIONS_COLLECTION).find().toArray();
    expect(records.map((r) => r._id)).toEqual([
      '001-initial',
      '002-auth',
      '003-service-order',
      '004-public-calendar',
      '005-booking-privacy',
    ]);
  });

  it('ist bei erneuter Ausführung idempotent', async () => {
    const db = freshDb();
    await runMigrations(db);
    const before = await indexNames(db, COLLECTIONS.bookings);
    const second = await runMigrations(db);
    expect(second).toEqual({
      applied: [],
      alreadyApplied: [
        '001-initial',
        '002-auth',
        '003-service-order',
        '004-public-calendar',
        '005-booking-privacy',
      ],
    });
    expect(await indexNames(db, COLLECTIONS.bookings)).toEqual(before);
  });

  it('wiederholt einen abgebrochenen Schritt beim nächsten Lauf', async () => {
    const db = freshDb();
    let calls = 0;
    const flaky: Migration = {
      id: '001-flaky',
      description: 'bricht beim ersten Mal ab',
      up() {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('Abbruch')) : Promise.resolve();
      },
    };
    await expect(runMigrations(db, [flaky])).rejects.toThrow('Abbruch');
    expect(await runMigrations(db, [flaky])).toEqual({
      applied: ['001-flaky'],
      alreadyApplied: [],
    });
  });

  it('lehnt eine Datenbank mit unbekannten Migrationen ab', async () => {
    const db = freshDb();
    await db.collection<{ _id: string }>(MIGRATIONS_COLLECTION).insertOne({ _id: '999-zukunft' });
    await expect(runMigrations(db)).rejects.toThrow(MigrationError);
  });

  it('verhindert parallele Läufe', async () => {
    const db = freshDb();
    await db.collection<{ _id: string }>(MIGRATIONS_COLLECTION).insertOne({ _id: '__lock' });
    await expect(runMigrations(db)).rejects.toThrow(/läuft bereits/);
  });
});

describe('001-initial', () => {
  let db: Db;

  beforeAll(async () => {
    db = freshDb();
    await runMigrations(db);
  });

  it('legt alle Collections an', async () => {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(Object.values(COLLECTIONS)));
  });

  it.each([
    [COLLECTIONS.owners, 'email_unique', { email: 1 }],
    [COLLECTIONS.openingHours, 'weekday_unique', { weekday: 1 }],
    [COLLECTIONS.sessions, 'ruleId_localStart_unique', { ruleId: 1, localStart: 1 }],
    [COLLECTIONS.bookings, 'idempotencyKey_unique', { idempotencyKey: 1 }],
    [
      COLLECTIONS.bookings,
      'session_participant_active_unique',
      { sessionId: 1, participantEmailKey: 1 },
    ],
    [COLLECTIONS.resourceOccupancy, 'resource_unit_unique', { resourceId: 1, unitStart: 1 }],
    [COLLECTIONS.actionTokens, 'tokenHash_unique', { tokenHash: 1 }],
    [COLLECTIONS.outboxJobs, 'dedupeKey_unique', { dedupeKey: 1 }],
  ])('%s hat eindeutigen Index %s', async (collection, name, key) => {
    const indexes = await indexNames(db, collection);
    expect(indexes[name]).toEqual({ unique: true, key });
  });

  it.each([
    [COLLECTIONS.sessions, ['startsAt', 'serviceId_startsAt']],
    [COLLECTIONS.bookings, ['startsAt', 'serviceId_startsAt', 'sessionId_status']],
    [COLLECTIONS.resourceOccupancy, ['ref']],
    [COLLECTIONS.outboxJobs, ['status_dueAt', 'bookingId']],
    [COLLECTIONS.auditEvents, ['at', 'object']],
  ])('%s hat Abfrage-Indizes', async (collection, names) => {
    const indexes = await indexNames(db, collection);
    for (const name of names) expect(indexes).toHaveProperty(name);
  });

  it('legt Standardeinstellungen an und überschreibt Änderungen nicht', async () => {
    const settings = collections(db).settings;
    expect(await settings.findOne({ _id: SETTINGS_ID })).toMatchObject({
      timeZone: 'Europe/Berlin',
      defaultMinLeadMinutes: 1440,
      defaultHorizonDays: 90,
      defaultChangeDeadlineMinutes: 1440,
      reminderLeadMinutes: 1440,
    });
    await settings.updateOne({ _id: SETTINGS_ID }, { $set: { timeZone: 'Europe/Vienna' } });
    const { initialMigration } = await import('./001-initial.js');
    await initialMigration.up(db);
    expect((await settings.findOne({ _id: SETTINGS_ID }))?.timeZone).toBe('Europe/Vienna');
  });
});

describe('Validatoren und eindeutige Indizes', () => {
  let db: Db;
  const now = new Date('2026-10-08T08:00:00Z');
  const later = new Date('2026-10-08T09:15:00Z');

  const session = (overrides: Partial<SessionDocument> = {}): SessionDocument => ({
    _id: new ObjectId(),
    serviceId: new ObjectId(),
    ruleId: null,
    localStart: '2026-10-08T10:00',
    startsAt: now,
    endsAt: later,
    timeZone: 'Europe/Berlin',
    capacity: 12,
    bookedCount: 0,
    status: 'scheduled',
    location: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const booking = (overrides: Partial<BookingDocument> = {}): BookingDocument => ({
    _id: new ObjectId(),
    serviceId: new ObjectId(),
    type: 'single',
    sessionId: null,
    startsAt: now,
    endsAt: later,
    timeZone: 'Europe/Berlin',
    status: 'confirmed',
    participant: { name: 'Erika', email: 'Erika@example.test', phone: '030 123456' },
    participantEmailKey: 'erika@example.test',
    idempotencyKey: new ObjectId().toHexString(),
    privacyAcceptedAt: new Date(),
    rebookedToBookingId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const rejectsWith = async (promise: Promise<unknown>, code: number) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).code).toBe(code);
  };
  const VALIDATION_FAILED = 121;
  const DUPLICATE_KEY = 11000;

  beforeAll(async () => {
    db = freshDb();
    await runMigrations(db);
  });

  beforeEach(async () => {
    const c = collections(db);
    await Promise.all([
      c.sessions.deleteMany({}),
      c.bookings.deleteMany({}),
      c.resourceOccupancy.deleteMany({}),
    ]);
  });

  describe('sessions', () => {
    it('akzeptiert einen gültigen Kurstermin', async () => {
      await collections(db).sessions.insertOne(session());
    });
    it('lehnt mehr Buchungen als Kapazität ab', async () => {
      await rejectsWith(
        collections(db).sessions.insertOne(session({ bookedCount: 13 })),
        VALIDATION_FAILED,
      );
    });
    it('lehnt auch ein Hochzählen über die Kapazität ab', async () => {
      const { insertedId } = await collections(db).sessions.insertOne(
        session({ capacity: 2, bookedCount: 2 }),
      );
      await rejectsWith(
        collections(db).sessions.updateOne({ _id: insertedId }, { $inc: { bookedCount: 1 } }),
        VALIDATION_FAILED,
      );
    });
    it('lehnt Kapazität unter 2 und unbekannte Status ab', async () => {
      await rejectsWith(
        collections(db).sessions.insertOne(session({ capacity: 1 })),
        VALIDATION_FAILED,
      );
      await rejectsWith(
        db.collection(COLLECTIONS.sessions).insertOne({ ...session(), status: 'deleted' }),
        VALIDATION_FAILED,
      );
    });
    it('lehnt Ende vor Beginn ab', async () => {
      await rejectsWith(
        collections(db).sessions.insertOne(session({ endsAt: now, startsAt: later })),
        VALIDATION_FAILED,
      );
    });
    it('erzeugt je Regel und lokalem Beginn nur einen Kurstermin', async () => {
      const ruleId = new ObjectId();
      await collections(db).sessions.insertOne(session({ ruleId }));
      await rejectsWith(collections(db).sessions.insertOne(session({ ruleId })), DUPLICATE_KEY);
      // Ohne Regel angelegte Termine sind davon nicht betroffen.
      await collections(db).sessions.insertOne(session());
      await collections(db).sessions.insertOne(session());
    });
  });

  describe('bookings', () => {
    it('akzeptiert eine gültige Buchung', async () => {
      await collections(db).bookings.insertOne(booking());
    });
    it('lehnt denselben Idempotenzschlüssel ab', async () => {
      await collections(db).bookings.insertOne(booking({ idempotencyKey: 'key-1234567890abcdef' }));
      await rejectsWith(
        collections(db).bookings.insertOne(booking({ idempotencyKey: 'key-1234567890abcdef' })),
        DUPLICATE_KEY,
      );
    });
    it('erlaubt pro Kurstermin nur eine aktive Buchung je E-Mail', async () => {
      const sessionId = new ObjectId();
      const group = { type: 'group' as const, sessionId };
      await collections(db).bookings.insertOne(booking({ ...group, status: 'cancelled' }));
      await collections(db).bookings.insertOne(booking(group));
      await rejectsWith(collections(db).bookings.insertOne(booking(group)), DUPLICATE_KEY);
    });
    it('verlangt sessionId genau bei Gruppenkursen', async () => {
      await rejectsWith(
        collections(db).bookings.insertOne(booking({ type: 'group', sessionId: null })),
        VALIDATION_FAILED,
      );
      await rejectsWith(
        collections(db).bookings.insertOne(booking({ type: 'single', sessionId: new ObjectId() })),
        VALIDATION_FAILED,
      );
    });
    it('verlangt vollständige Teilnehmerdaten', async () => {
      await rejectsWith(
        db.collection(COLLECTIONS.bookings).insertOne({
          ...booking(),
          participant: { name: 'Erika', email: 'erika@example.test' },
        }),
        VALIDATION_FAILED,
      );
    });
  });

  describe('resourceOccupancy', () => {
    const unit = (unitStart: Date) => ({
      _id: new ObjectId(),
      resourceId: 'default',
      unitStart,
      refType: 'booking' as const,
      refId: new ObjectId(),
    });

    it('lehnt eine doppelt belegte Einheit ab', async () => {
      await collections(db).resourceOccupancy.insertOne(unit(now));
      await rejectsWith(collections(db).resourceOccupancy.insertOne(unit(now)), DUPLICATE_KEY);
    });
    it('lehnt Einheiten außerhalb des 5-Minuten-Rasters ab', async () => {
      await rejectsWith(
        collections(db).resourceOccupancy.insertOne(unit(new Date('2026-10-08T08:03:00Z'))),
        VALIDATION_FAILED,
      );
    });
  });

  it('lehnt Action-Tokens ohne gültigen SHA-256-Hash ab', async () => {
    await rejectsWith(
      collections(db).actionTokens.insertOne({
        _id: new ObjectId(),
        tokenHash: 'klartext-token',
        bookingId: new ObjectId(),
        status: 'active',
        expiresAt: later,
        createdAt: now,
      }),
      VALIDATION_FAILED,
    );
  });
});
