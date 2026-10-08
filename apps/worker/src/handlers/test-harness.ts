// Gemeinsamer Testaufbau der Mail-Handler: echtes Replica Set, SMTP-Testserver, der Mails
// mitschneidet oder Empfänger ablehnt, sowie Fabriken für Angebote, Buchungen und Aufträge.
// Nur für Tests; registriert die Vitest-Hooks beim Aufruf von `useMailHarness`.
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { collections, runMigrations } from '@fw-booking/db';
import type {
  BookingDocument,
  GroupServiceDocument,
  OutboxJobDocument,
  OutboxJobType,
  SessionDocument,
  SingleServiceDocument,
} from '@fw-booking/db';
import { startReplSet } from '@fw-booking/db/testing';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { SMTPServer } from 'smtp-server';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import type { WorkerConfig } from '../config.js';
import { SmtpMailer } from '../mail/mailer.js';
import { Worker } from '../worker.js';
import { createHandlers } from './index.js';

export const MAIL: WorkerConfig['mail'] = {
  fromAddress: 'termine@friseur.test',
  replyTo: 'info@friseur.test',
  businessName: 'Friseur Muster',
  businessPhone: '030 123456',
  managePageUrl: 'https://friseur.test/termin-verwalten',
  bookingPageUrl: 'https://friseur.test/termine',
};

export const RULES = { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null };
export const START = new Date(Date.now() + 5 * 86_400_000);

export interface MailHarness {
  readonly db: Db;
  readonly smtpPort: number;
  /** Rohfassungen aller angenommenen Mails dieses Tests. */
  readonly received: string[];
  /** Antwort des SMTP-Testservers auf RCPT TO; `null` = annehmen. */
  rcptReply: { code: number; message: string } | null;
  setup(port?: number): { worker: Worker; logs: string[] };
  singleService(): Promise<SingleServiceDocument>;
  groupSession(location?: string | null): Promise<{
    service: GroupServiceDocument;
    session: SessionDocument;
  }>;
  booking(
    serviceId: ObjectId,
    session: SessionDocument | null,
    overrides?: Partial<BookingDocument>,
  ): Promise<BookingDocument>;
  job(type: OutboxJobType, booking: BookingDocument): Promise<OutboxJobDocument>;
  reloadJob(job: OutboxJobDocument): Promise<OutboxJobDocument | null>;
  /** Die `index`-te empfangene Mail, geparst. */
  mail(index?: number): Promise<ParsedMail>;
}

export function useMailHarness(dbName: string): MailHarness {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let smtp: SMTPServer;
  let mailers: SmtpMailer[] = [];

  const harness = {
    db: undefined as unknown as Db,
    smtpPort: 0,
    received: [] as string[],
    rcptReply: null as MailHarness['rcptReply'],

    setup(port?: number) {
      const mailer = new SmtpMailer({
        smtp: {
          host: '127.0.0.1',
          port: port ?? harness.smtpPort,
          secure: false,
          requireTls: false,
          auth: null,
        },
        mail: MAIL,
      });
      mailers.push(mailer);
      const logs: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          logs.push(chunk.toString('utf8'));
          callback();
        },
      });
      const worker = new Worker(
        harness.db,
        createHandlers({ mailer, mail: MAIL }),
        { concurrency: 1, pollIntervalMs: 20 },
        pino({ level: 'info' }, stream),
      );
      return { worker, logs };
    },

    async singleService() {
      const service: SingleServiceDocument = {
        _id: new ObjectId(),
        type: 'single',
        title: 'Haarschnitt',
        description: null,
        active: true,
        durationMinutes: 30,
        bookingRules: RULES,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await collections(harness.db).services.insertOne(service);
      return service;
    },

    async groupSession(location: string | null = 'Studio 1') {
      const service: GroupServiceDocument = {
        _id: new ObjectId(),
        type: 'group',
        title: 'Yoga',
        description: null,
        active: true,
        durationMinutes: 75,
        defaultCapacity: 12,
        bookingRules: RULES,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const session: SessionDocument = {
        _id: new ObjectId(),
        serviceId: service._id,
        ruleId: null,
        localStart: `test-${new ObjectId().toHexString()}`,
        startsAt: START,
        endsAt: new Date(START.getTime() + 75 * 60_000),
        timeZone: 'Europe/Berlin',
        capacity: 12,
        bookedCount: 0,
        status: 'scheduled',
        location,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await collections(harness.db).services.insertOne(service);
      await collections(harness.db).sessions.insertOne(session);
      return { service, session };
    },

    async booking(
      serviceId: ObjectId,
      session: SessionDocument | null,
      overrides: Partial<BookingDocument> = {},
    ) {
      const now = new Date();
      const startsAt = overrides.startsAt ?? session?.startsAt ?? START;
      const booking: BookingDocument = {
        _id: new ObjectId(),
        serviceId,
        type: session ? 'group' : 'single',
        sessionId: session?._id ?? null,
        startsAt,
        endsAt: session?.endsAt ?? new Date(startsAt.getTime() + 30 * 60_000),
        timeZone: 'Europe/Berlin',
        status: 'confirmed',
        participant: { name: 'Erika Mustermann', email: 'erika@example.test', phone: '0301234567' },
        participantEmailKey: 'erika@example.test',
        idempotencyKey: new ObjectId().toHexString(),
        privacyAcceptedAt: now,
        rebookedToBookingId: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
      await collections(harness.db).bookings.insertOne(booking);
      return booking;
    },

    async job(type: OutboxJobType, booking: BookingDocument) {
      const now = new Date();
      const job: OutboxJobDocument = {
        _id: new ObjectId(),
        type,
        status: 'pending',
        dedupeKey: `${type}:${booking._id.toHexString()}`,
        bookingId: booking._id,
        dueAt: now,
        attempts: 0,
        leaseUntil: null,
        lastErrorCategory: null,
        createdAt: now,
        updatedAt: now,
      };
      await collections(harness.db).outboxJobs.insertOne(job);
      return job;
    },

    reloadJob(job: OutboxJobDocument) {
      return collections(harness.db).outboxJobs.findOne({ _id: job._id });
    },

    mail(index = 0) {
      return simpleParser(harness.received[index] ?? '');
    },
  };

  beforeAll(async () => {
    replSet = await startReplSet();
    client = await MongoClient.connect(replSet.getUri());
    harness.db = client.db(dbName);
    await runMigrations(harness.db);

    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onRcptTo(_address, _session, callback) {
        const reply = harness.rcptReply;
        if (reply) {
          callback(Object.assign(new Error(reply.message), { responseCode: reply.code }));
          return;
        }
        callback();
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          harness.received.push(Buffer.concat(chunks).toString('utf8'));
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => {
      smtp.listen(0, '127.0.0.1', resolve);
    });
    harness.smtpPort = (smtp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      smtp.close(() => {
        resolve();
      });
    });
    await client.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    const c = collections(harness.db);
    await Promise.all([
      c.services.deleteMany({}),
      c.sessions.deleteMany({}),
      c.bookings.deleteMany({}),
      c.outboxJobs.deleteMany({}),
      c.actionTokens.deleteMany({}),
    ]);
    harness.rcptReply = null;
    harness.received.length = 0;
  });

  afterEach(() => {
    for (const mailer of mailers) mailer.close();
    mailers = [];
  });

  return harness;
}
