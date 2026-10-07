import {
  availableDatesResponseSchema,
  ownerCalendarResponseSchema,
  publicServicesResponseSchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
} from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { SessionDocument } from '../database/documents.js';
import { runMigrations } from '../database/migrations/runner.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { assertPublic } from './public-response.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;
let calendarId: string;
let base: string;

const OPEN = { minLeadMinutes: 0, horizonDays: 30, changeDeadlineMinutes: null };

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  owner = await loginAsOwner(t);
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  calendarId = settings?.publicCalendarId ?? '';
  base = `/api/public/calendars/${calendarId}`;
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
    c.openingHours.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
  ]);
});

const http = () => request(t.app.getHttpServer());
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function session(
  serviceId: ObjectId,
  offsetDays: number,
  overrides: Partial<SessionDocument> = {},
) {
  const startsAt = new Date(Date.now() + offsetDays * 86_400_000);
  startsAt.setUTCHours(16, 0, 0, 0);
  return {
    _id: new ObjectId(),
    serviceId,
    ruleId: null,
    localStart: '2026-01-01T17:00',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 75 * 60_000),
    timeZone: 'Europe/Berlin',
    capacity: 12,
    bookedCount: 0,
    status: 'scheduled' as const,
    location: 'Studio 1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Kalenderkennung', () => {
  it('wird bei der Einrichtung erzeugt und bei erneuter Migration nicht verändert', async () => {
    expect(calendarId).toMatch(/^cal_[A-Za-z0-9_-]{16}$/);
    await runMigrations(t.db);
    const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
    expect(settings?.publicCalendarId).toBe(calendarId);
  });

  it('ist für den Owner abrufbar', async () => {
    await http().get('/api/owner/calendar').expect(401);
    const response = await http()
      .get('/api/owner/calendar')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(ownerCalendarResponseSchema.parse(response.body)).toEqual({
      calendarId,
      timeZone: 'Europe/Berlin',
    });
  });

  it('liefert 404 für unbekannte Kalender', async () => {
    await http().get('/api/public/calendars/cal_unbekannt1234567890/services').expect(404);
  });
});

describe('Öffentliche Angebote', () => {
  it('liefert aktive Angebote in Reihenfolge ohne Anmeldung und ohne interne Felder', async () => {
    await collections(t.db).services.insertMany([
      groupService({ title: 'Yoga', sortOrder: 1 }),
      singleService({ title: 'Haarschnitt', sortOrder: 0, bufferMinutes: 10 }),
      singleService({ title: 'Alt', sortOrder: 2, active: false }),
    ]);
    const response = await http().get(`${base}/services`).expect(200);
    const body = publicServicesResponseSchema.parse(response.body);
    expect(body.timeZone).toBe('Europe/Berlin');
    expect(body.services.map((s) => s.title)).toEqual(['Haarschnitt', 'Yoga']);
    expect(body.services[0]).toEqual({
      id: expect.any(String) as string,
      type: 'single',
      title: 'Haarschnitt',
      description: null,
      durationMinutes: 30,
      slotGridMinutes: 30,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /bufferMinutes|bookingRules|sortOrder|active/,
    );
    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });
});

describe('Öffentliche Slots und freie Tage', () => {
  async function setupSingle() {
    const svc = singleService({ bookingRules: OPEN });
    await collections(t.db).services.insertOne(svc);
    // Jeden Wochentag 09:00–12:00 Ortszeit geöffnet.
    await collections(t.db).openingHours.insertMany(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        _id: new ObjectId(),
        weekday,
        windows: [{ start: '09:00', end: '12:00' }],
      })),
    );
    return svc;
  }

  it('liefert freie Slots und lässt belegte Einzeltermine weg', async () => {
    const svc = await setupSingle();
    const date = day(3);
    const before = publicSlotsResponseSchema.parse(
      (await http().get(`${base}/services/${svc._id.toHexString()}/slots?date=${date}`).expect(200))
        .body,
    );
    expect(before.slots).toHaveLength(6);

    const first = before.slots[0];
    if (!first) throw new Error('kein Slot');
    await collections(t.db).resourceOccupancy.insertMany(
      [0, 1, 2, 3, 4, 5].map((i) => ({
        _id: new ObjectId(),
        resourceId: 'default',
        unitStart: new Date(Date.parse(first.startsAt) + i * 5 * 60_000),
        refType: 'booking' as const,
        refId: new ObjectId(),
      })),
    );
    const response = await http()
      .get(`${base}/services/${svc._id.toHexString()}/slots?date=${date}`)
      .expect(200);
    const after = publicSlotsResponseSchema.parse(response.body);
    expect(after.slots).toHaveLength(5);
    expect(after.slots.map((s) => s.startsAt)).not.toContain(first.startsAt);
    expect(response.headers['cache-control']).toBe('public, max-age=30');
  });

  it('liefert freie Tage', async () => {
    const svc = await setupSingle();
    const response = await http()
      .get(`${base}/services/${svc._id.toHexString()}/available-dates?from=${day(1)}&to=${day(7)}`)
      .expect(200);
    expect(availableDatesResponseSchema.parse(response.body).dates).toHaveLength(7);
  });

  it('lehnt Gruppenkurse, deaktivierte und unbekannte Angebote ab', async () => {
    const group = groupService({ bookingRules: OPEN });
    const inactive = singleService({ active: false, bookingRules: OPEN });
    await collections(t.db).services.insertMany([group, inactive]);
    await http()
      .get(`${base}/services/${group._id.toHexString()}/slots?date=${day(2)}`)
      .expect(400);
    await http()
      .get(`${base}/services/${inactive._id.toHexString()}/slots?date=${day(2)}`)
      .expect(404);
    await http()
      .get(`${base}/services/${new ObjectId().toHexString()}/slots?date=${day(2)}`)
      .expect(404);
    await http()
      .get(`${base}/services/keine-id/slots?date=${day(2)}`)
      .expect(404);
    await http().get(`${base}/services/${inactive._id.toHexString()}/slots`).expect(400);
  });
});

describe('Öffentliche Kurstermine', () => {
  it('liefert geplante Termine mit freien Plätzen, auch ausgebuchte', async () => {
    const svc = groupService({ bookingRules: OPEN });
    await collections(t.db).services.insertOne(svc);
    const open = session(svc._id, 2);
    const full = session(svc._id, 3, { bookedCount: 12 });
    const blocked = session(svc._id, 4, { status: 'blocked' });
    const cancelled = session(svc._id, 5, { status: 'cancelled' });
    const beyond = session(svc._id, 40);
    await collections(t.db).sessions.insertMany([open, full, blocked, cancelled, beyond]);

    const response = await http()
      .get(`${base}/services/${svc._id.toHexString()}/sessions?from=${day(0)}&to=${day(45)}`)
      .expect(200);
    const body = publicSessionsResponseSchema.parse(response.body);
    expect(body.sessions.map((s) => [s.id, s.freeSeats])).toEqual([
      [open._id.toHexString(), 12],
      [full._id.toHexString(), 0],
    ]);
    expect(body.sessions[0]).toMatchObject({ location: 'Studio 1' });
    expect(JSON.stringify(response.body)).not.toMatch(/capacity|bookedCount|ruleId|status/);
    expect(response.headers['cache-control']).toBe('public, max-age=30');
  });

  it('beachtet den Mindestvorlauf', async () => {
    const svc = groupService({
      bookingRules: { minLeadMinutes: 3 * 24 * 60, horizonDays: 30, changeDeadlineMinutes: null },
    });
    await collections(t.db).services.insertOne(svc);
    const soon = session(svc._id, 1);
    const later = session(svc._id, 5);
    await collections(t.db).sessions.insertMany([soon, later]);
    const body = publicSessionsResponseSchema.parse(
      (
        await http()
          .get(`${base}/services/${svc._id.toHexString()}/sessions?from=${day(0)}&to=${day(10)}`)
          .expect(200)
      ).body,
    );
    expect(body.sessions.map((s) => s.id)).toEqual([later._id.toHexString()]);
  });

  it('lehnt Einzeltermine und zu lange Zeiträume ab', async () => {
    const single = singleService({ bookingRules: OPEN });
    const group = groupService({ bookingRules: OPEN });
    await collections(t.db).services.insertMany([single, group]);
    await http()
      .get(`${base}/services/${single._id.toHexString()}/sessions?from=${day(0)}&to=${day(7)}`)
      .expect(400);
    await http()
      .get(`${base}/services/${group._id.toHexString()}/sessions?from=${day(0)}&to=${day(70)}`)
      .expect(400);
  });
});

describe('assertPublic', () => {
  const schema = z.strictObject({ id: z.string(), freeSeats: z.number() });

  it('lässt gültige Antworten durch', () => {
    expect(assertPublic(schema, { id: 'x', freeSeats: 3 })).toEqual({ id: 'x', freeSeats: 3 });
  });

  it('verhindert die Auslieferung zusätzlicher Felder wie Teilnehmerdaten', () => {
    expect(() =>
      assertPublic(schema, { id: 'x', freeSeats: 3, participants: [{ name: 'Erika' }] }),
    ).toThrow(/öffentlichen Format/);
  });
});
