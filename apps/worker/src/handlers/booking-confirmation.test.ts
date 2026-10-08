import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { SETTINGS_ID, collections, hashActionToken, runMigrations } from '@fw-booking/db';
import type {
  BookingDocument,
  GroupServiceDocument,
  OutboxJobDocument,
  SessionDocument,
  SingleServiceDocument,
} from '@fw-booking/db';
import { startReplSet } from '@fw-booking/db/testing';
import { formatDateTime } from '@fw-booking/shared';
import { simpleParser } from 'mailparser';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { SMTPServer } from 'smtp-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerConfig } from '../config.js';
import { SmtpMailer } from '../mail/mailer.js';
import { Worker } from '../worker.js';
import { createHandlers } from './index.js';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let smtp: SMTPServer;
let smtpPort: number;

/** Verhalten des SMTP-Testservers je Test. */
let rcptReply: { code: number; message: string } | null = null;
let received: string[] = [];

const MAIL: WorkerConfig['mail'] = {
  fromAddress: 'termine@friseur.test',
  replyTo: 'info@friseur.test',
  businessName: 'Friseur Muster',
  businessPhone: '030 123456',
  managePageUrl: 'https://friseur.test/termin-verwalten',
  bookingPageUrl: 'https://friseur.test/termine',
};

const RULES = { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null };
const START = new Date(Date.now() + 5 * 86_400_000);

beforeAll(async () => {
  replSet = await startReplSet();
  client = await MongoClient.connect(replSet.getUri());
  db = client.db('worker_mail_test');
  await runMigrations(db);

  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onRcptTo(_address, _session, callback) {
      if (rcptReply) {
        const error = Object.assign(new Error(rcptReply.message), {
          responseCode: rcptReply.code,
        });
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  smtpPort = (smtp.server.address() as AddressInfo).port;
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
  const c = collections(db);
  await Promise.all([
    c.services.deleteMany({}),
    c.sessions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.outboxJobs.deleteMany({}),
    c.actionTokens.deleteMany({}),
  ]);
  rcptReply = null;
  received = [];
});

let mailers: SmtpMailer[] = [];
afterEach(() => {
  for (const m of mailers) m.close();
  mailers = [];
});

function setup(port = smtpPort): { worker: Worker; logs: string[] } {
  const mailer = new SmtpMailer({
    smtp: { host: '127.0.0.1', port, secure: false, requireTls: false, auth: null },
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
    db,
    createHandlers({ mailer, mail: MAIL }),
    { concurrency: 1, pollIntervalMs: 20 },
    pino({ level: 'info' }, stream),
  );
  return { worker, logs };
}

async function insertSingle(
  overrides: Partial<BookingDocument> = {},
): Promise<{ booking: BookingDocument; job: OutboxJobDocument; service: SingleServiceDocument }> {
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
  await collections(db).services.insertOne(service);
  return insertBooking(service._id, null, overrides, service);
}

async function insertBooking<S>(
  serviceId: ObjectId,
  session: SessionDocument | null,
  overrides: Partial<BookingDocument>,
  service: S,
): Promise<{ booking: BookingDocument; job: OutboxJobDocument; service: S }> {
  const now = new Date();
  const startsAt = session?.startsAt ?? START;
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
  const job: OutboxJobDocument = {
    _id: new ObjectId(),
    type: 'booking_confirmation',
    status: 'pending',
    dedupeKey: `booking_confirmation:${booking._id.toHexString()}`,
    bookingId: booking._id,
    dueAt: now,
    attempts: 0,
    leaseUntil: null,
    lastErrorCategory: null,
    createdAt: now,
    updatedAt: now,
  };
  await collections(db).bookings.insertOne(booking);
  await collections(db).outboxJobs.insertOne(job);
  return { booking, job, service };
}

const reloadJob = (job: OutboxJobDocument) => collections(db).outboxJobs.findOne({ _id: job._id });

describe('Bestätigungsmail', () => {
  it('versendet Termin, Angebot und einen gültigen Verwaltungslink', async () => {
    const { booking, job } = await insertSingle();
    const { worker } = setup();
    expect(await worker.processNext()).toBe(true);

    expect(await reloadJob(job)).toMatchObject({ status: 'sent', result: 'sent', attempts: 1 });
    expect(received).toHaveLength(1);
    const mail = await simpleParser(received[0] ?? '');
    expect(mail.to).toMatchObject({ value: [{ address: 'erika@example.test' }] });
    expect(mail.from?.value[0]).toEqual({
      name: 'Friseur Muster',
      address: 'termine@friseur.test',
    });
    expect(mail.replyTo?.value[0]?.address).toBe('info@friseur.test');
    expect(mail.messageId).toBe(`<${job._id.toHexString()}.booking_confirmation@friseur.test>`);
    expect(mail.subject).toMatch(/^Terminbestätigung: Haarschnitt am /);
    expect(mail.text).toContain('Hallo Erika Mustermann,');
    expect(mail.text).toContain('Uhrzeit:');
    expect(mail.html).toContain('Buchung verwalten');

    const token = /#t=([A-Za-z0-9_-]{43})/.exec(mail.text ?? '')?.[1];
    expect(token).toBeDefined();
    const stored = await collections(db).actionTokens.findOne({
      tokenHash: hashActionToken(token ?? ''),
    });
    expect(stored).toMatchObject({ bookingId: booking._id, status: 'active' });
    expect(stored?.expiresAt).toEqual(booking.endsAt);
    // Klartext des Tokens liegt nirgends in der Datenbank.
    const everything = JSON.stringify(await collections(db).actionTokens.find().toArray());
    expect(everything).not.toContain(token);

    const ics = mail.attachments.find((a) => a.filename === 'termin.ics');
    expect(ics?.contentType).toBe('text/calendar');
    expect(ics?.content.toString('utf8')).toContain('SUMMARY:Haarschnitt – Friseur Muster');
  });

  it('nennt bei Kursen den Ort des Kurstermins', async () => {
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
      localStart: '2026-10-20T18:30',
      startsAt: START,
      endsAt: new Date(START.getTime() + 75 * 60_000),
      timeZone: 'Europe/Berlin',
      capacity: 12,
      bookedCount: 1,
      status: 'scheduled',
      location: 'Studio 1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await collections(db).services.insertOne(service);
    await collections(db).sessions.insertOne(session);
    await insertBooking(service._id, session, {}, service);
    await setup().worker.processNext();
    const mail = await simpleParser(received[0] ?? '');
    expect(mail.text).toContain('Angebot: Yoga');
    expect(mail.text).toContain('Ort: Studio 1');
  });

  it('nutzt die Änderungsfrist des Angebots bzw. der Installation', async () => {
    const { service } = await insertSingle();
    await collections(db).services.updateOne(
      { _id: service._id },
      { $set: { 'bookingRules.changeDeadlineMinutes': 48 * 60 } },
    );
    await setup().worker.processNext();
    const mail = await simpleParser(received[0] ?? '');
    const settings = await collections(db).settings.findOne({ _id: SETTINGS_ID });
    expect(settings?.defaultChangeDeadlineMinutes).toBe(24 * 60);
    const deadline = new Date(START.getTime() - 48 * 3_600_000).toISOString();
    expect(mail.text).toContain(`Bis ${formatDateTime(deadline, 'Europe/Berlin')} Uhr kannst du`);
  });

  it.each(['cancelled', 'rebooked', 'cancelled_by_owner'] as const)(
    'überspringt Buchungen mit Status %s ohne Mail und ohne Link',
    async (status) => {
      const { job } = await insertSingle({
        status,
        rebookedToBookingId: status === 'rebooked' ? new ObjectId() : null,
      });
      await setup().worker.processNext();
      expect(await reloadJob(job)).toMatchObject({ status: 'sent', result: 'skipped' });
      expect(received).toHaveLength(0);
      expect(await collections(db).actionTokens.countDocuments()).toBe(0);
    },
  );

  it('markiert Aufträge ohne Buchung als dauerhaft fehlgeschlagen', async () => {
    const { booking, job } = await insertSingle();
    await collections(db).bookings.deleteOne({ _id: booking._id });
    await setup().worker.processNext();
    expect(await reloadJob(job)).toMatchObject({
      status: 'failed',
      lastErrorCategory: 'booking_missing',
    });
    expect(received).toHaveLength(0);
  });
});

describe('Versandfehler', () => {
  it('wiederholt bei nicht erreichbarem Mailserver und lässt die Buchung unverändert', async () => {
    const { booking, job } = await insertSingle();
    // Port eines geschlossenen Servers
    const closed = new SMTPServer({ logger: false });
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });

    await setup(port).worker.processNext();
    expect(await reloadJob(job)).toMatchObject({
      status: 'pending',
      lastErrorCategory: 'smtp_unavailable',
    });
    expect(await collections(db).bookings.findOne({ _id: booking._id })).toEqual(booking);
    // Kein verwaister Link aus dem gescheiterten Versuch
    expect(await collections(db).actionTokens.countDocuments()).toBe(0);
  });

  it('wiederholt bei vorübergehender Ablehnung (4xx)', async () => {
    const { job } = await insertSingle();
    rcptReply = { code: 451, message: 'Bitte später erneut' };
    await setup().worker.processNext();
    expect(await reloadJob(job)).toMatchObject({
      status: 'pending',
      lastErrorCategory: 'smtp_deferred',
    });
  });

  it('gibt bei abgelehntem Empfänger (5xx) sofort auf', async () => {
    const { booking, job } = await insertSingle();
    rcptReply = { code: 550, message: 'Mailbox unbekannt erika@example.test' };
    await setup().worker.processNext();
    const after = await reloadJob(job);
    expect(after).toMatchObject({ status: 'failed', lastErrorCategory: 'recipient_rejected' });
    expect(JSON.stringify(after)).not.toContain('erika');
    expect((await collections(db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
  });

  it('schreibt keine Teilnehmerdaten oder Links in die Logs', async () => {
    await insertSingle();
    const { worker, logs } = setup();
    await worker.processNext();
    rcptReply = { code: 550, message: 'Mailbox unbekannt erika@example.test' };
    await insertSingle();
    await worker.processNext();
    const output = logs.join('');
    expect(output).toContain('Job erledigt');
    expect(output).toContain('recipient_rejected');
    for (const secret of ['erika@example.test', 'Erika Mustermann', '0301234567', '#t=']) {
      expect(output).not.toContain(secret);
    }
  });
});
