import { collections, runMigrations } from '@fw-booking/db';
import type { OutboxJobDocument } from '@fw-booking/db';
import { startReplSet } from '@fw-booking/db/testing';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { permanentFailure, temporaryFailure } from './errors.js';
import { JobQueue } from './queue.js';
import { MAX_ATTEMPTS } from './retry.js';
import { Worker } from './worker.js';
import type { JobHandler, JobHandlers, JobResult, WorkerOptions } from './worker.js';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;

const silent = pino({ level: 'silent' });
const MINUTE = 60_000;

beforeAll(async () => {
  replSet = await startReplSet();
  client = await MongoClient.connect(replSet.getUri());
  db = client.db('worker_test');
  await runMigrations(db);
});

afterAll(async () => {
  await client.close();
  await replSet.stop();
});

beforeEach(async () => {
  await collections(db).outboxJobs.deleteMany({});
});

let counter = 0;
function job(overrides: Partial<OutboxJobDocument> = {}): OutboxJobDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    type: 'booking_confirmation',
    status: 'pending',
    dedupeKey: `test:${String(++counter)}:${new ObjectId().toHexString()}`,
    bookingId: new ObjectId(),
    dueAt: new Date(now.getTime() - 1000),
    attempts: 0,
    leaseUntil: null,
    lastErrorCategory: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function insert(...docs: OutboxJobDocument[]): Promise<void> {
  await collections(db).outboxJobs.insertMany(docs);
}

const reload = async (doc: OutboxJobDocument) =>
  collections(db).outboxJobs.findOne({ _id: doc._id });

function worker(handlers: JobHandlers, options: Partial<WorkerOptions> = {}): Worker {
  return new Worker(db, handlers, { concurrency: 1, pollIntervalMs: 20, ...options }, silent);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > until) throw new Error('Zeitüberschreitung beim Warten');
    await sleep(20);
  }
}

describe('Beanspruchen', () => {
  it('beansprucht nur fällige Jobs registrierter Typen', async () => {
    const due = job();
    const later = job({ dueAt: new Date(Date.now() + MINUTE) });
    const otherType = job({ type: 'booking_reminder' });
    const sent = job({ status: 'sent' });
    const failed = job({ status: 'failed' });
    await insert(due, later, otherType, sent, failed);

    const queue = new JobQueue(db);
    const claimed = await queue.claim(['booking_confirmation']);
    expect(claimed?._id).toEqual(due._id);
    expect(claimed).toMatchObject({ status: 'processing', attempts: 1 });
    expect(claimed?.leaseToken).toMatch(/^[0-9a-f]{32}$/);
    expect(claimed?.leaseUntil.getTime()).toBeGreaterThan(Date.now() + 4 * MINUTE);
    expect(await queue.claim(['booking_confirmation'])).toBeNull();
    expect(await queue.claim([])).toBeNull();
    expect((await reload(otherType))?.status).toBe('pending');
  });

  it('vergibt Jobs in Reihenfolge der Fälligkeit', async () => {
    const newer = job({ dueAt: new Date(Date.now() - 1000) });
    const older = job({ dueAt: new Date(Date.now() - 60_000) });
    await insert(newer, older);
    const queue = new JobQueue(db);
    expect((await queue.claim(['booking_confirmation']))?._id).toEqual(older._id);
    expect((await queue.claim(['booking_confirmation']))?._id).toEqual(newer._id);
  });

  it('lässt Jobs ohne registrierten Handler unangetastet', async () => {
    const confirmation = job();
    await insert(confirmation);
    const w = worker({});
    expect(await w.processNext()).toBe(false);
    expect(await reload(confirmation)).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('Mehrere Worker', () => {
  it('verarbeiten jeden Job genau einmal', async () => {
    const jobs = Array.from({ length: 120 }, () => job());
    await insert(...jobs);
    const calls = new Map<string, number>();
    const handler: JobHandler = async (j) => {
      const id = j._id.toHexString();
      calls.set(id, (calls.get(id) ?? 0) + 1);
      await sleep(Math.random() * 5);
      return 'sent';
    };
    const workers = Array.from({ length: 5 }, () =>
      worker({ booking_confirmation: handler }, { concurrency: 4 }),
    );
    for (const w of workers) w.start();
    await waitFor(
      async () =>
        (await collections(db).outboxJobs.countDocuments({ status: 'sent' })) === jobs.length,
    );
    await Promise.all(workers.map((w) => w.stop()));

    expect(calls.size).toBe(jobs.length);
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
    const docs = await collections(db).outboxJobs.find().toArray();
    expect(docs.every((d) => d.attempts === 1 && d.leaseToken === null)).toBe(true);
    expect(docs.every((d) => d.completedAt instanceof Date)).toBe(true);
  });

  it('beanspruchen einen Job auch bei gleichzeitigen Anfragen nur einmal', async () => {
    await insert(job());
    const queue = new JobQueue(db);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => queue.claim(['booking_confirmation'])),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('Abgelaufene Leases', () => {
  it('vergibt Jobs mit abgelaufener Lease erneut', async () => {
    const crashed = job({
      status: 'processing',
      attempts: 1,
      leaseUntil: new Date(Date.now() - 1000),
      leaseToken: 'alter-worker',
    });
    const active = job({
      status: 'processing',
      attempts: 1,
      leaseUntil: new Date(Date.now() + MINUTE),
      leaseToken: 'laufender-worker',
    });
    await insert(crashed, active);
    const handled: string[] = [];
    const w = worker({
      booking_confirmation: (j) => {
        handled.push(j._id.toHexString());
        return Promise.resolve('sent' as const);
      },
    });
    expect(await w.processNext()).toBe(true);
    expect(await w.processNext()).toBe(false);
    expect(handled).toEqual([crashed._id.toHexString()]);
    expect(await reload(crashed)).toMatchObject({ status: 'sent', attempts: 2 });
    expect(await reload(active)).toMatchObject({
      status: 'processing',
      leaseToken: 'laufender-worker',
    });
  });

  it('verwirft das Ergebnis eines Workers, dessen Lease neu vergeben wurde', async () => {
    await insert(job());
    const slow = new JobQueue(db, { leaseMs: 50 });
    const fast = new JobQueue(db);
    const first = await slow.claim(['booking_confirmation']);
    await sleep(80);
    const second = await fast.claim(['booking_confirmation']);
    if (!first || !second) throw new Error('Job nicht beansprucht');
    expect(second._id).toEqual(first._id);
    expect(second.attempts).toBe(2);

    // Der alte Worker meldet sich zu spät: weder Erfolg noch Fehler werden übernommen.
    expect(await slow.complete(first)).toBe(false);
    expect(await slow.fail(first, 'smtp_unavailable', true)).toBeNull();
    expect(await reload(first)).toMatchObject({
      status: 'processing',
      leaseToken: second.leaseToken,
    });
    expect(await fast.complete(second)).toBe(true);
    expect(await reload(first)).toMatchObject({ status: 'sent', lastErrorCategory: null });
  });

  it('markiert Jobs nach zu vielen abgelaufenen Leases als fehlgeschlagen, ohne sie auszuführen', async () => {
    const doc = job({
      status: 'processing',
      attempts: MAX_ATTEMPTS,
      leaseUntil: new Date(Date.now() - 1000),
      leaseToken: 'abgestuerzt',
    });
    await insert(doc);
    let called = false;
    const w = worker({
      booking_confirmation: () => {
        called = true;
        return Promise.resolve('sent' as const);
      },
    });
    await w.processNext();
    expect(called).toBe(false);
    expect(await reload(doc)).toMatchObject({
      status: 'failed',
      lastErrorCategory: 'lease_expired',
      leaseToken: null,
    });
  });
});

describe('Fehler und Wiederholungen', () => {
  it('wiederholt vorübergehende Fehler mit Backoff', async () => {
    const doc = job();
    await insert(doc);
    const w = worker({
      booking_confirmation: () => Promise.reject(temporaryFailure('smtp_unavailable')),
    });
    const before = Date.now();
    await w.processNext();
    const after = await reload(doc);
    expect(after).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCategory: 'smtp_unavailable',
      leaseUntil: null,
      leaseToken: null,
    });
    const delay = (after?.dueAt.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThanOrEqual(0.9 * MINUTE - 1000);
    expect(delay).toBeLessThanOrEqual(1.1 * MINUTE + 1000);
    // Vor Ablauf des Backoffs wird der Job nicht erneut beansprucht.
    expect(await w.processNext()).toBe(false);
  });

  it('markiert Jobs nach der Höchstzahl an Versuchen als fehlgeschlagen', async () => {
    const doc = job();
    await insert(doc);
    let calls = 0;
    const w = worker({
      booking_confirmation: () => {
        calls += 1;
        return Promise.reject(temporaryFailure('smtp_unavailable'));
      },
    });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Backoff überspringen: Job sofort wieder fällig machen.
      await collections(db).outboxJobs.updateOne(
        { _id: doc._id, status: 'pending' },
        { $set: { dueAt: new Date(Date.now() - 1000) } },
      );
      expect(await w.processNext()).toBe(true);
    }
    expect(calls).toBe(MAX_ATTEMPTS);
    const after = await reload(doc);
    expect(after).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      lastErrorCategory: 'smtp_unavailable',
    });
    expect(after?.failedAt).toBeInstanceOf(Date);
    expect(await w.processNext()).toBe(false);
  });

  it('beendet dauerhafte Fehler sofort', async () => {
    const doc = job();
    await insert(doc);
    const w = worker({
      booking_confirmation: () => Promise.reject(permanentFailure('booking_missing')),
    });
    await w.processNext();
    expect(await reload(doc)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastErrorCategory: 'booking_missing',
    });
  });

  it('speichert bei unerwarteten Fehlern nur eine Kategorie, nie die Meldung', async () => {
    const doc = job();
    await insert(doc);
    const w = worker({
      booking_confirmation: () =>
        Promise.reject(new Error('auth failed for smtp://user:geheim@mail.example.test')),
    });
    await w.processNext();
    const after = await reload(doc);
    expect(after).toMatchObject({ status: 'pending', lastErrorCategory: 'unexpected' });
    expect(JSON.stringify(after)).not.toContain('geheim');
  });

  it('bricht Handler nach dem Zeitlimit ab und plant eine Wiederholung', async () => {
    const doc = job();
    await insert(doc);
    let aborted = false;
    const w = worker(
      {
        booking_confirmation: (_job, { signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve('sent');
            });
          }),
      },
      { handlerTimeoutMs: 50 },
    );
    await w.processNext();
    expect(aborted).toBe(true);
    expect(await reload(doc)).toMatchObject({ status: 'pending', lastErrorCategory: 'timeout' });
  });
});

describe('Lebenszyklus', () => {
  it('beendet laufende Jobs beim Stoppen und nimmt danach keine neuen an', async () => {
    const first = job({ dueAt: new Date(Date.now() - 2000) });
    const second = job();
    await insert(first, second);
    let release: (result: JobResult) => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const w = worker({
      booking_confirmation: () =>
        new Promise<JobResult>((resolve) => {
          release = resolve;
          markStarted();
        }),
    });
    w.start();
    await started;
    const stopped = w.stop();
    await sleep(50);
    // Solange der Job läuft, ist der Worker nicht beendet.
    expect((await reload(first))?.status).toBe('processing');
    release('sent');
    await stopped;
    expect((await reload(first))?.status).toBe('sent');
    expect(await reload(second)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('wartet ohne fällige Jobs und greift neue Jobs beim nächsten Abfragen auf', async () => {
    const handled: string[] = [];
    const w = worker({
      booking_reminder: (j) => {
        handled.push(j._id.toHexString());
        return Promise.resolve('sent' as const);
      },
    });
    w.start();
    await sleep(60);
    const doc = job({ type: 'booking_reminder' });
    await insert(doc);
    await waitFor(async () => (await reload(doc))?.status === 'sent');
    await w.stop();
    expect(handled).toEqual([doc._id.toHexString()]);
  });
});
