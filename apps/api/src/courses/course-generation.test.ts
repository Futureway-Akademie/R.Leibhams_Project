import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { SlotService } from '../availability/slot.service.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { GroupServiceDocument } from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { groupBooking, groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { CourseRulesService } from './course-rules.service.js';
import { CourseSessionsService } from './course-sessions.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let rules: CourseRulesService;
let sessions: CourseSessionsService;

// Donnerstag, 01.10.2026, 10:00 Ortszeit
const NOW = new Date('2026-10-01T08:00:00Z');
const owner: AuthenticatedOwner = { id: new ObjectId(), email: 'owner@example.test' };

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  rules = t.app.get(CourseRulesService);
  sessions = t.app.get(CourseSessionsService);
});

afterAll(async () => {
  await t.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.courseRules.deleteMany({}),
    c.sessions.deleteMany({}),
    c.bookings.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
    c.availabilityExceptions.deleteMany({}),
    c.openingHours.deleteMany({}),
  ]);
  await c.settings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { timeZone: 'Europe/Berlin', defaultHorizonDays: 90 } },
  );
});

async function service(horizonDays: number | null, overrides: Partial<GroupServiceDocument> = {}) {
  const doc = groupService({
    bookingRules: { minLeadMinutes: null, horizonDays, changeDeadlineMinutes: null },
    ...overrides,
  });
  await collections(t.db).services.insertOne(doc);
  return doc;
}

/** Montag und Mittwoch 18:30, ab 01.10.2026. */
async function createRule(svc: GroupServiceDocument, overrides: Record<string, unknown> = {}) {
  return rules.create(
    {
      serviceId: svc._id.toHexString(),
      weekdays: [1, 3],
      startTime: '18:30',
      validFrom: '2026-10-01',
      validUntil: null,
      capacity: null,
      location: null,
      ...overrides,
    },
    owner,
    NOW,
  );
}

async function sessionStarts(ruleId?: ObjectId): Promise<string[]> {
  const filter = ruleId ? { ruleId, status: { $ne: 'cancelled' as const } } : {};
  return (
    await collections(t.db)
      .sessions.find(filter, { sort: { startsAt: 1 } })
      .toArray()
  ).map((s) => s.startsAt.toISOString());
}

describe('Erzeugung aus Regeln', () => {
  it('erzeugt Termine im Buchungshorizont mit Belegung der Ressource', async () => {
    const svc = await service(14);
    const { rule, generation } = await createRule(svc);
    expect(generation).toEqual({ created: 4, conflicts: [], keptWithBookings: [] });
    expect(await sessionStarts(rule._id)).toEqual([
      '2026-10-05T16:30:00.000Z',
      '2026-10-07T16:30:00.000Z',
      '2026-10-12T16:30:00.000Z',
      '2026-10-14T16:30:00.000Z',
    ]);
    const first = await collections(t.db).sessions.findOne({ ruleId: rule._id });
    expect(first).toMatchObject({
      capacity: 12,
      bookedCount: 0,
      status: 'scheduled',
      localStart: '2026-10-05T18:30',
      endsAt: new Date('2026-10-05T17:45:00Z'),
    });
    // 75 Minuten = 15 Einheiten je Termin
    expect(await collections(t.db).resourceOccupancy.countDocuments({ refType: 'session' })).toBe(
      60,
    );
  });

  it('ist idempotent und schiebt mit wanderndem Horizont nach', async () => {
    const svc = await service(14);
    const { rule } = await createRule(svc);
    expect(await rules.generateForRule(rule, NOW)).toMatchObject({ created: 0 });
    const later = await rules.generateForRule(rule, new Date('2026-10-08T08:00:00Z'));
    expect(later.created).toBe(2); // 19.10. und 21.10.
    expect(await sessionStarts(rule._id)).toHaveLength(6);
  });

  it('rechnet über die Zeitumstellung korrekt um', async () => {
    const svc = await service(30);
    const { rule } = await createRule(svc);
    const starts = await sessionStarts(rule._id);
    expect(starts).toContain('2026-10-21T16:30:00.000Z'); // 18:30 MESZ
    expect(starts).toContain('2026-10-26T17:30:00.000Z'); // 18:30 MEZ
  });

  it('beachtet Gültigkeitszeitraum, Kapazität und Ort der Regel', async () => {
    const svc = await service(30);
    const { rule } = await createRule(svc, {
      validFrom: '2026-10-06',
      validUntil: '2026-10-13',
      capacity: 8,
      location: 'Studio 2',
    });
    expect(await sessionStarts(rule._id)).toEqual([
      '2026-10-07T16:30:00.000Z',
      '2026-10-12T16:30:00.000Z',
    ]);
    expect(await collections(t.db).sessions.findOne({ ruleId: rule._id })).toMatchObject({
      capacity: 8,
      location: 'Studio 2',
    });
  });

  it('erzeugt keine Kurse in Sperrzeiten', async () => {
    await collections(t.db).availabilityExceptions.insertOne({
      _id: new ObjectId(),
      kind: 'closed',
      start: '2026-10-12T00:00',
      end: '2026-10-13T00:00',
      note: 'Fortbildung',
      createdAt: NOW,
    });
    const svc = await service(14);
    const { rule } = await createRule(svc);
    expect(await sessionStarts(rule._id)).not.toContain('2026-10-12T16:30:00.000Z');
    expect(await sessionStarts(rule._id)).toHaveLength(3);
  });

  it('meldet Überschneidungen als Konflikt und legt dort nichts an', async () => {
    const svc = await service(14);
    const other = await service(14, { title: 'Pilates' });
    await sessions.createManual(
      {
        serviceId: other._id.toHexString(),
        startsAt: '2026-10-07T16:00:00Z',
        capacity: null,
        location: null,
      },
      owner,
      NOW,
    );
    const { rule, generation } = await createRule(svc);
    expect(generation.conflicts).toEqual(['2026-10-07T18:30']);
    expect(generation.created).toBe(3);
    expect(await sessionStarts(rule._id)).not.toContain('2026-10-07T16:30:00.000Z');
  });

  it('lässt Termine in der übersprungenen Stunde entfallen', async () => {
    const svc = await service(14);
    const { rule } = await rules.create(
      {
        serviceId: svc._id.toHexString(),
        weekdays: [7],
        startTime: '02:30',
        validFrom: '2026-03-20',
        validUntil: null,
        capacity: null,
        location: null,
      },
      owner,
      new Date('2026-03-20T08:00:00Z'),
    );
    // Sonntage 22.03. und 29.03.; am 29.03. gibt es 02:30 nicht.
    expect(await sessionStarts(rule._id)).toEqual(['2026-03-22T01:30:00.000Z']);
  });

  it('erzeugt nichts für deaktivierte Angebote und nichts in der Vergangenheit', async () => {
    const inactive = await service(14, { active: false });
    expect((await createRule(inactive)).generation.created).toBe(0);
    const svc = await service(14);
    const { rule } = await createRule(svc, { validFrom: '2026-09-01' });
    expect((await sessionStarts(rule._id))[0]).toBe('2026-10-05T16:30:00.000Z');
  });

  it('erzeugt über alle Regeln', async () => {
    const svc = await service(14);
    const a = await createRule(svc);
    const b = await createRule(svc, { weekdays: [5], startTime: '09:00' });
    await collections(t.db).sessions.deleteMany({});
    await collections(t.db).resourceOccupancy.deleteMany({});
    await rules.generateAll(NOW);
    expect(await sessionStarts(a.rule._id)).toHaveLength(4);
    expect(await sessionStarts(b.rule._id)).toHaveLength(2);
  });

  it('blockiert die Slots von Einzelterminen (gemeinsame Ressource)', async () => {
    await collections(t.db).openingHours.insertOne({
      _id: new ObjectId(),
      weekday: 1,
      windows: [{ start: '18:00', end: '20:00' }],
    });
    const haircut = singleService();
    const svc = await service(14);
    await createRule(svc);
    const slots = await t.app.get(SlotService).slotsForDate(haircut, '2026-10-05', NOW);
    // Kurs 18:30–19:45 Ortszeit belegt die Ressource; nur 18:00–18:30 bleibt frei.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-05T16:00:00.000Z']);
  });
});

describe('Regeln ändern und löschen', () => {
  async function setup() {
    const svc = await service(14);
    const { rule } = await createRule(svc);
    // Buchung auf dem Termin am 07.10.
    const booked = await collections(t.db).sessions.findOne({ localStart: '2026-10-07T18:30' });
    if (!booked) throw new Error('Termin fehlt');
    await collections(t.db).bookings.insertOne(groupBooking(booked._id, svc._id));
    await collections(t.db).sessions.updateOne({ _id: booked._id }, { $set: { bookedCount: 1 } });
    return { svc, rule, booked };
  }

  it('erzeugt ungebuchte künftige Termine neu und lässt gebuchte unverändert', async () => {
    const { rule, booked } = await setup();
    const result = await rules.update(rule._id, { startTime: '19:00' }, owner, NOW);
    expect(result.generation.keptWithBookings).toEqual(['2026-10-07T18:30']);
    // 19:00 am 07.10. überschneidet sich mit dem gebuchten Termin 18:30–19:45.
    expect(result.generation.conflicts).toEqual(['2026-10-07T19:00']);
    expect(result.generation.created).toBe(3);
    expect(await sessionStarts(rule._id)).toEqual([
      '2026-10-05T17:00:00.000Z',
      '2026-10-07T16:30:00.000Z', // gebucht, unverändert
      '2026-10-12T17:00:00.000Z',
      '2026-10-14T17:00:00.000Z',
    ]);
    expect(await collections(t.db).sessions.findOne({ _id: booked._id })).toMatchObject({
      bookedCount: 1,
      status: 'scheduled',
    });
  });

  it('übernimmt eine geänderte Kapazität nur für ungebuchte Termine', async () => {
    const { rule, booked } = await setup();
    await rules.update(rule._id, { capacity: 6 }, owner, NOW);
    expect((await collections(t.db).sessions.findOne({ _id: booked._id }))?.capacity).toBe(12);
    const others = await collections(t.db)
      .sessions.find({ ruleId: rule._id, _id: { $ne: booked._id } })
      .toArray();
    expect(others.map((s) => s.capacity)).toEqual([6, 6, 6]);
  });

  it('lehnt einen ungültigen Zeitraum nach Zusammenführung ab', async () => {
    const { rule } = await setup();
    await expect(rules.update(rule._id, { validUntil: '2026-09-01' }, owner, NOW)).rejects.toThrow(
      /Gültig bis/,
    );
  });

  it('löscht die Regel und ihre ungebuchten künftigen Termine', async () => {
    const { rule, booked } = await setup();
    const result = await rules.remove(rule._id, owner, NOW);
    expect(result.keptWithBookings).toEqual(['2026-10-07T18:30']);
    expect(await collections(t.db).courseRules.countDocuments()).toBe(0);
    const remaining = await collections(t.db).sessions.find().toArray();
    expect(remaining.map((s) => s._id.toHexString())).toEqual([booked._id.toHexString()]);
    expect(await collections(t.db).resourceOccupancy.countDocuments({ refId: booked._id })).toBe(
      15,
    );
    expect(await collections(t.db).resourceOccupancy.countDocuments()).toBe(15);
  });

  it('lässt vergangene Termine unangetastet', async () => {
    const { rule } = await setup();
    const later = new Date('2026-10-06T08:00:00Z');
    await rules.update(rule._id, { startTime: '19:00' }, owner, later);
    expect(await sessionStarts(rule._id)).toContain('2026-10-05T16:30:00.000Z');
  });
});

describe('Entfernte Regeltermine', () => {
  it('werden als abgesagt markiert, geben die Ressource frei und entstehen nicht neu', async () => {
    const svc = await service(14);
    const { rule } = await createRule(svc);
    const first = await collections(t.db).sessions.findOne({ localStart: '2026-10-05T18:30' });
    if (!first) throw new Error('Termin fehlt');
    await sessions.remove(first._id, owner);
    expect((await collections(t.db).sessions.findOne({ _id: first._id }))?.status).toBe(
      'cancelled',
    );
    expect(await collections(t.db).resourceOccupancy.countDocuments({ refId: first._id })).toBe(0);
    expect((await rules.generateForRule(rule, NOW)).created).toBe(0);
    expect(await sessionStarts(rule._id)).toHaveLength(3);
  });

  it('bleiben bei Verschiebung ihrem Wiederholungsschlüssel zugeordnet', async () => {
    const svc = await service(14);
    const { rule } = await createRule(svc);
    const first = await collections(t.db).sessions.findOne({ localStart: '2026-10-05T18:30' });
    if (!first) throw new Error('Termin fehlt');
    await sessions.update(first._id, { startsAt: '2026-10-05T15:00:00Z' }, owner, NOW);
    expect((await rules.generateForRule(rule, NOW)).created).toBe(0);
    expect(await collections(t.db).sessions.findOne({ _id: first._id })).toMatchObject({
      localStart: '2026-10-05T18:30',
      startsAt: new Date('2026-10-05T15:00:00Z'),
      endsAt: new Date('2026-10-05T16:15:00Z'),
    });
  });
});
