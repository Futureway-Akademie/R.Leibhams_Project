// Nebenläufigkeitstests gegen ein echtes Replica Set (task-2-11).
// Normallauf: CONCURRENCY_LOAD=50, CONCURRENCY_ROUNDS=1 (Teil von pnpm test).
// Lastlauf:   pnpm --filter @fw-booking/api test:concurrency (200 parallele Anfragen, 20 Durchläufe).
import { Agent } from 'node:http';
import { addLocalDays, localToUtc, localToday } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CourseRulesService } from '../courses/course-rules.service.js';
import { CourseSessionsService } from '../courses/course-sessions.service.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { SessionDocument } from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { checkConsistency } from '../testing/consistency.js';
import { groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';

const LOAD = Number(process.env.CONCURRENCY_LOAD ?? 50);
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 1);
const TIMEOUT = 120_000 * ROUNDS;
const TZ = 'Europe/Berlin';
const OPEN = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };
const owner: AuthenticatedOwner = { id: new ObjectId(), email: 'owner@example.test' };

let replSet: MongoMemoryReplSet;
let t: TestApp;
let bookingsUrl: string;
let baseUrl: string;
let date: string;

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  // Einmal auf einem echten Port lauschen: supertest würde sonst je Anfrage einen eigenen
  // Listener starten, was bei hunderten gleichzeitigen Anfragen zu Verbindungsabbrüchen führt.
  await t.app.listen(0, '127.0.0.1');
  baseUrl = await t.app.getUrl();
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  bookingsUrl = `/api/public/calendars/${settings?.publicCalendarId ?? ''}/bookings`;
  date = addLocalDays(localToday(TZ), 3);
});

afterAll(async () => {
  agent.destroy();
  await t.close();
  await replSet.stop();
});

/** Lokale Uhrzeit am Testtag als UTC-String. */
function at(time: string): string {
  const result = localToUtc(`${date}T${time}`, TZ);
  if (!result.ok) throw new Error(`Ungültige Testzeit ${time}`);
  return result.utc;
}

async function reset(): Promise<void> {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.sessions.deleteMany({}),
    c.courseRules.deleteMany({}),
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
      windows: [{ start: '08:00', end: '18:00' }],
    })),
  );
}

let keyCounter = 0;
const key = () => `conc-${String(Date.now())}-${String(++keyCounter)}`;
const participant = (i: number) => ({
  name: `Person ${String(i)}`,
  email: `person${String(i)}@example.test`,
  phone: '030 123456',
});

// Höchstens 64 gleichzeitige Verbindungen mit Keep-Alive: macOS begrenzt die Warteschlange für
// neue Verbindungen auf 128 (kern.ipc.somaxconn). Alle Anfragen werden trotzdem auf einmal
// abgeschickt und konkurrieren gleichzeitig um dieselben Plätze.
const agent = new Agent({ keepAlive: true, maxSockets: 64 });
const book = (payload: object) => request(baseUrl).post(bookingsUrl).agent(agent).send(payload);

function groupRequest(sessionId: ObjectId, i: number, idempotencyKey = key()) {
  return book({
    type: 'group',
    sessionId: sessionId.toHexString(),
    participant: participant(i),
    idempotencyKey,
    privacyAccepted: true,
  });
}

function singleRequest(serviceId: ObjectId, startsAt: string, i: number) {
  return book({
    type: 'single',
    serviceId: serviceId.toHexString(),
    startsAt,
    participant: participant(i),
    idempotencyKey: key(),
    privacyAccepted: true,
  });
}

async function insertSession(capacity: number, startTime = '10:00'): Promise<SessionDocument> {
  const svc = groupService({ bookingRules: OPEN });
  await collections(t.db).services.insertOne(svc);
  const startsAt = new Date(at(startTime));
  const session: SessionDocument = {
    _id: new ObjectId(),
    serviceId: svc._id,
    ruleId: null,
    localStart: `${date}T${startTime}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 75 * 60_000),
    timeZone: TZ,
    capacity,
    bookedCount: 0,
    status: 'scheduled',
    location: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await collections(t.db).sessions.insertOne(session);
  return session;
}

/** Sammelt Abweichungen über alle Durchläufe; am Ende muss die Liste leer sein. */
async function runRounds(name: string, scenario: (round: number) => Promise<string[]>) {
  const anomalies: string[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    await reset();
    const found = [...(await scenario(round)), ...(await checkConsistency(t.db))];
    anomalies.push(...found.map((a) => `${name} #${String(round)}: ${a}`));
  }
  console.info(
    `[concurrency] ${name}: ${String(ROUNDS)} Durchläufe × ${String(LOAD)} Anfragen, ${String(anomalies.length)} Abweichungen`,
  );
  if (anomalies.length > 0) console.info(anomalies.join('\n'));
  expect(anomalies).toEqual([]);
}

function unexpectedStatuses(responses: request.Response[], allowed: number[]): string[] {
  return responses
    .filter((r) => !allowed.includes(r.status))
    .map((r) => `unerwarteter Status ${String(r.status)}: ${JSON.stringify(r.body)}`);
}

describe('Nebenläufigkeit', () => {
  it(
    'Kurs mit N Plätzen: genau N Buchungen, auch mit Doppelklicks',
    { timeout: TIMEOUT },
    async () => {
      await runRounds('Kurs N Plätze', async () => {
        const capacity = 5;
        const session = await insertSession(capacity);
        const sharedKeys = Array.from({ length: 5 }, () => key());
        // Jede fünfte Anfrage ist ein Doppelklick: gleicher Schlüssel, gleiche Person.
        const responses = await Promise.all(
          Array.from({ length: LOAD }, (_, i) => {
            if (i % 5 !== 0) return groupRequest(session._id, i);
            const k = (i / 5) % sharedKeys.length;
            return groupRequest(session._id, 1000 + k, sharedKeys[k]);
          }),
        );
        const issues = unexpectedStatuses(responses, [200, 201, 409]);
        const confirmed = await collections(t.db).bookings.countDocuments({ status: 'confirmed' });
        if (confirmed !== capacity)
          issues.push(`${String(confirmed)} statt ${String(capacity)} Buchungen`);
        return issues;
      });
    },
  );

  it(
    'Kapazität senken während gebucht wird: nie über der Kapazität',
    { timeout: TIMEOUT },
    async () => {
      const service = t.app.get(CourseSessionsService);
      await runRounds('Kapazität senken', async () => {
        const session = await insertSession(20);
        const [responses, reduce] = await Promise.all([
          Promise.all(Array.from({ length: LOAD }, (_, i) => groupRequest(session._id, i))),
          new Promise((resolve) => setTimeout(resolve, 5))
            .then(() => service.update(session._id, { capacity: 10 }, owner))
            .then(
              () => 'ok',
              (e: unknown) => (e as Error).message,
            ),
        ]);
        const issues = unexpectedStatuses(responses, [201, 409]);
        const current = await collections(t.db).sessions.findOne({ _id: session._id });
        if (!current) return ['Kurstermin fehlt'];
        if (reduce === 'ok' && current.capacity !== 10)
          issues.push('Senkung gemeldet, aber nicht gespeichert');
        if (reduce !== 'ok' && !/Kapazität/.test(reduce))
          issues.push(`Senkung mit unerwartetem Fehler: ${reduce}`);
        if (current.bookedCount > current.capacity) issues.push('überbucht nach Senkung');
        return issues;
      });
    },
  );

  it(
    'Kurstermin sperren während gebucht wird: danach keine neuen Buchungen',
    { timeout: TIMEOUT },
    async () => {
      const service = t.app.get(CourseSessionsService);
      await runRounds('Sperren', async () => {
        const session = await insertSession(LOAD * 2);
        const [first] = await Promise.all([
          Promise.all(Array.from({ length: LOAD }, (_, i) => groupRequest(session._id, i))),
          new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
            service.update(session._id, { status: 'blocked' }, owner),
          ),
        ]);
        const before = await collections(t.db).bookings.countDocuments();
        const second = await Promise.all(
          Array.from({ length: 10 }, (_, i) => groupRequest(session._id, 5000 + i)),
        );
        const issues = unexpectedStatuses(first, [201, 409]);
        if (second.some((r) => r.status !== 409))
          issues.push('Buchung nach dem Sperren angenommen');
        if ((await collections(t.db).bookings.countDocuments()) !== before) {
          issues.push('Buchungen nach dem Sperren gespeichert');
        }
        return issues;
      });
    },
  );

  it(
    'Kurstermin anlegen vs. Einzelbuchung zur selben Zeit: genau einer gewinnt',
    { timeout: TIMEOUT },
    async () => {
      const service = t.app.get(CourseSessionsService);
      await runRounds('Kurs vs. Einzeltermin', async () => {
        const single = singleService({ bookingRules: OPEN });
        const course = groupService({ bookingRules: OPEN });
        await collections(t.db).services.insertMany([single, course]);
        const startsAt = at('10:00');
        const [responses, created] = await Promise.all([
          Promise.all(
            Array.from({ length: LOAD }, (_, i) => singleRequest(single._id, startsAt, i)),
          ),
          service
            .createManual(
              { serviceId: course._id.toHexString(), startsAt, capacity: null, location: null },
              owner,
            )
            .then(
              () => true,
              () => false,
            ),
        ]);
        const issues = unexpectedStatuses(responses, [201, 409]);
        const won = responses.filter((r) => r.status === 201).length;
        if (won + (created ? 1 : 0) !== 1) {
          issues.push(`${String(won)} Einzelbuchungen und Kurstermin=${String(created)}`);
        }
        return issues;
      });
    },
  );

  it(
    'Erzeugung aus Kursregeln vs. Einzelbuchungen: keine Doppelbelegung',
    { timeout: TIMEOUT },
    async () => {
      const rules = t.app.get(CourseRulesService);
      await runRounds('Regeln vs. Einzeltermin', async () => {
        const single = singleService({ bookingRules: OPEN });
        const course = groupService({ bookingRules: OPEN });
        await collections(t.db).services.insertMany([single, course]);
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
        const startsAt = at('10:00');
        const [responses, result] = await Promise.all([
          Promise.all(
            Array.from({ length: LOAD }, (_, i) => singleRequest(single._id, startsAt, i)),
          ),
          rules.create(
            {
              serviceId: course._id.toHexString(),
              weekdays: [weekday],
              startTime: '10:00',
              validFrom: date,
              validUntil: date,
              capacity: null,
              location: null,
            },
            owner,
          ),
        ]);
        const issues = unexpectedStatuses(responses, [201, 409]);
        const won = responses.filter((r) => r.status === 201).length;
        const session = await collections(t.db).sessions.countDocuments({ status: 'scheduled' });
        if (won + session !== 1)
          issues.push(`${String(won)} Einzelbuchungen und ${String(session)} Kurstermine`);
        if (won === 1 && result.generation.conflicts.length !== 1) {
          issues.push('verdrängter Kurstermin nicht als Konflikt gemeldet');
        }
        return issues;
      });
    },
  );

  it(
    'Überlappende Einzelbuchungen mehrerer Angebote: Belegungen überschneiden sich nie',
    { timeout: TIMEOUT },
    async () => {
      await runRounds('Überlappende Einzeltermine', async () => {
        const services = [20, 45, 90].map((durationMinutes) =>
          singleService({ durationMinutes, bookingRules: OPEN }),
        );
        await collections(t.db).services.insertMany(services);
        // Startzeiten 09:00–10:55 im 5-Minuten-Raster, zufällig auf Angebote verteilt.
        const starts = Array.from({ length: 24 }, (_, i) =>
          at(
            `${String(9 + Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`,
          ),
        );
        const responses = await Promise.all(
          Array.from({ length: LOAD }, (_, i) =>
            singleRequest(
              services[i % 3]?._id ?? new ObjectId(),
              starts[Math.floor(Math.random() * starts.length)] ?? starts[0] ?? '',
              i,
            ),
          ),
        );
        const issues = unexpectedStatuses(responses, [201, 409]);
        const confirmed = await collections(t.db)
          .bookings.find({ status: 'confirmed' }, { sort: { startsAt: 1 } })
          .toArray();
        for (let i = 1; i < confirmed.length; i++) {
          const prev = confirmed[i - 1];
          const cur = confirmed[i];
          if (prev && cur && cur.startsAt < prev.endsAt)
            issues.push('überlappende Einzelbuchungen');
        }
        if (confirmed.length === 0) issues.push('keine einzige Buchung erfolgreich');
        return issues;
      });
    },
  );
});
