import { publicSlotsResponseSchema, selfServiceBookingSchema } from '@fw-booking/shared';
import type { SelfServiceBooking } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../auth/crypto.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type {
  BookingDocument,
  GroupServiceDocument,
  SessionDocument,
  SingleServiceDocument,
} from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { checkConsistency } from '../testing/consistency.js';
import { groupService, singleService } from '../testing/fixtures.js';
import { startReplSet } from '../testing/mongo.js';
import { ActionTokenService } from './action-token.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let tokens: ActionTokenService;
let base: string;

const RULES = { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: null };
const DATE = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  tokens = t.app.get(ActionTokenService);
  const settings = await collections(t.db).settings.findOne({ _id: SETTINGS_ID });
  base = `/api/public/calendars/${settings?.publicCalendarId ?? ''}`;
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
    c.bookings.deleteMany({}),
    c.outboxJobs.deleteMany({}),
    c.auditEvents.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
    c.actionTokens.deleteMany({}),
    c.openingHours.deleteMany({}),
  ]);
  await c.openingHours.insertMany(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      _id: new ObjectId(),
      weekday,
      windows: [{ start: '09:00', end: '12:00' }],
    })),
  );
});

const http = () => request(t.app.getHttpServer());
let counter = 0;
const participant = () => ({
  name: 'Erika Mustermann',
  email: `erika${String(++counter)}@example.test`,
  phone: '030 123456',
});

async function groupBooking(
  serviceOverrides: Partial<GroupServiceDocument> = {},
): Promise<{ booking: BookingDocument; session: SessionDocument }> {
  const service = groupService({ bookingRules: RULES, ...serviceOverrides });
  await collections(t.db).services.insertOne(service);
  const startsAt = new Date(`${DATE}T16:30:00Z`);
  const session: SessionDocument = {
    _id: new ObjectId(),
    serviceId: service._id,
    ruleId: null,
    localStart: `${DATE}T18:30`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 75 * 60_000),
    timeZone: 'Europe/Berlin',
    capacity: 2,
    bookedCount: 0,
    status: 'scheduled',
    location: 'Studio 1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await collections(t.db).sessions.insertOne(session);
  await http()
    .post(`${base}/bookings`)
    .send({
      type: 'group',
      sessionId: session._id.toHexString(),
      participant: participant(),
      idempotencyKey: `self-service-${String(++counter)}-key-xyz`,
      privacyAccepted: true,
    })
    .expect(201);
  const booking = await collections(t.db).bookings.findOne({ sessionId: session._id });
  if (!booking) throw new Error('Buchung fehlt');
  return { booking, session };
}

async function singleBooking(): Promise<{
  booking: BookingDocument;
  service: SingleServiceDocument;
}> {
  const service = singleService({ bookingRules: RULES });
  await collections(t.db).services.insertOne(service);
  const slots = publicSlotsResponseSchema.parse(
    (await http().get(`${base}/services/${service._id.toHexString()}/slots?date=${DATE}`)).body,
  ).slots;
  await http()
    .post(`${base}/bookings`)
    .send({
      type: 'single',
      serviceId: service._id.toHexString(),
      startsAt: slots[0]?.startsAt,
      participant: participant(),
      idempotencyKey: `self-service-${String(++counter)}-key-xyz`,
      privacyAccepted: true,
    })
    .expect(201);
  const booking = await collections(t.db).bookings.findOne({ serviceId: service._id });
  if (!booking) throw new Error('Buchung fehlt');
  return { booking, service };
}

const view = (token?: string) => {
  const r = http().get('/api/public/manage');
  return token ? r.set('X-Booking-Token', token) : r;
};
const cancel = (token: string, body: object = { confirm: true }) =>
  http().post('/api/public/manage/cancel').set('X-Booking-Token', token).send(body);

describe('Verwaltungs-Tokens', () => {
  it('speichert nur den Hash und gilt bis zum Terminende', async () => {
    const { booking } = await groupBooking();
    const token = await tokens.issue(booking);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await collections(t.db).actionTokens.findOne({ bookingId: booking._id });
    expect(stored).toMatchObject({
      tokenHash: sha256Hex(token),
      status: 'active',
      expiresAt: booking.endsAt,
    });
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('erlaubt mehrere gleichzeitig gültige Links je Buchung', async () => {
    const { booking } = await groupBooking();
    const a = await tokens.issue(booking);
    const b = await tokens.issue(booking);
    await view(a).expect(200);
    await view(b).expect(200);
  });
});

describe('Ansicht', () => {
  it('zeigt Angebot, Zeit, Status und Name – ohne E-Mail und Telefon', async () => {
    const { booking, session } = await groupBooking();
    const token = await tokens.issue(booking);
    const response = await view(token).expect(200);
    const body = selfServiceBookingSchema.parse(response.body);
    expect(body).toMatchObject({
      type: 'group',
      serviceTitle: 'Yoga',
      participantName: 'Erika Mustermann',
      status: 'confirmed',
      location: 'Studio 1',
      canCancel: true,
      canRebook: true,
      startsAt: session.startsAt.toISOString().replace('.000Z', 'Z'),
    });
    // Standardfrist 24 Stunden vor Beginn
    expect(Date.parse(body.startsAt) - Date.parse(body.changeDeadline)).toBe(24 * 3600_000);
    expect(JSON.stringify(response.body)).not.toMatch(/example\.test|030 123456/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('ändert beim Öffnen nichts', async () => {
    const { booking } = await groupBooking();
    const token = await tokens.issue(booking);
    await view(token).expect(200);
    await view(token).expect(200);
    expect((await collections(t.db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
    expect(
      await collections(t.db).outboxJobs.countDocuments({ type: 'booking_cancellation' }),
    ).toBe(0);
  });

  it('liefert 404 ohne, mit falschem oder ungültigem Token und 410 nach Ablauf', async () => {
    const { booking } = await groupBooking();
    await view().expect(404);
    await view('x'.repeat(43)).expect(404);
    await view('zu-kurz').expect(404);
    const token = await tokens.issue(booking);
    await collections(t.db).actionTokens.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const expired = await view(token).expect(410);
    expect(expired.body).toMatchObject({ code: 'link_expired' });
  });

  it('akzeptiert das Token nicht in der URL', async () => {
    const { booking } = await groupBooking();
    const token = await tokens.issue(booking);
    await http().get(`/api/public/manage?t=${token}`).expect(404);
    await http().get(`/api/public/manage/${token}`).expect(404);
  });
});

describe('Storno', () => {
  it('storniert einen Kursplatz und gibt ihn genau einmal frei', async () => {
    const { booking, session } = await groupBooking();
    const token = await tokens.issue(booking);
    const response = await cancel(token).expect(200);
    expect(response.body).toMatchObject({
      status: 'cancelled',
      canCancel: false,
      alreadyCancelled: false,
    });

    expect(await collections(t.db).sessions.findOne({ _id: session._id })).toMatchObject({
      bookedCount: 0,
    });
    expect(await collections(t.db).actionTokens.findOne({ bookingId: booking._id })).toMatchObject({
      status: 'used',
    });
    const job = await collections(t.db).outboxJobs.findOne({ type: 'booking_cancellation' });
    expect(job).toMatchObject({ bookingId: booking._id, status: 'pending' });
    const audit = await collections(t.db).auditEvents.findOne({ action: 'booking.cancelled' });
    expect(audit?.actor).toEqual({ type: 'participant', id: null });
    expect(JSON.stringify(audit)).not.toMatch(/Erika|example\.test/);

    const again = await cancel(token).expect(200);
    expect(again.body).toMatchObject({ status: 'cancelled', alreadyCancelled: true });
    expect(await collections(t.db).sessions.findOne({ _id: session._id })).toMatchObject({
      bookedCount: 0,
    });
    expect(
      await collections(t.db).outboxJobs.countDocuments({ type: 'booking_cancellation' }),
    ).toBe(1);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('gibt bei Einzelterminen die belegte Zeit wieder frei', async () => {
    const { booking, service } = await singleBooking();
    const slotsUrl = `${base}/services/${service._id.toHexString()}/slots?date=${DATE}`;
    const before = publicSlotsResponseSchema.parse((await http().get(slotsUrl)).body).slots.length;
    await cancel(await tokens.issue(booking)).expect(200);
    expect(await collections(t.db).resourceOccupancy.countDocuments()).toBe(0);
    const after = publicSlotsResponseSchema.parse((await http().get(slotsUrl)).body).slots.length;
    expect(after).toBeGreaterThan(before);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('entwertet Aktionen aller Links, die aber den Status weiter zeigen', async () => {
    const { booking } = await groupBooking();
    const a = await tokens.issue(booking);
    const b = await tokens.issue(booking);
    await cancel(a).expect(200);
    const viaB = await view(b).expect(200);
    expect((viaB.body as SelfServiceBooking).status).toBe('cancelled');
    expect((await cancel(b).expect(200)).body).toMatchObject({ alreadyCancelled: true });
  });

  it('gibt bei gleichzeitigen Storno-Aufrufen genau einmal frei', async () => {
    const { booking, session } = await groupBooking();
    const token = await tokens.issue(booking);
    const responses = await Promise.all(Array.from({ length: 10 }, () => cancel(token)));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(
      responses.filter((r) => !(r.body as { alreadyCancelled: boolean }).alreadyCancelled),
    ).toHaveLength(1);
    expect(await collections(t.db).sessions.findOne({ _id: session._id })).toMatchObject({
      bookedCount: 0,
    });
    expect(
      await collections(t.db).outboxJobs.countDocuments({ type: 'booking_cancellation' }),
    ).toBe(1);
    expect(await checkConsistency(t.db)).toEqual([]);
  });

  it('lehnt Storno nach Ablauf der Frist ab', async () => {
    const { booking } = await groupBooking({
      bookingRules: { minLeadMinutes: 60, horizonDays: 30, changeDeadlineMinutes: 5 * 24 * 60 },
    });
    const token = await tokens.issue(booking);
    expect((await view(token).expect(200)).body).toMatchObject({
      canCancel: false,
      canRebook: false,
    });
    const response = await cancel(token).expect(409);
    expect(response.body).toMatchObject({ code: 'change_deadline_passed' });
    expect((await collections(t.db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
  });

  it('lehnt Storno vom Owner abgesagter Buchungen ab', async () => {
    const { booking } = await groupBooking();
    const token = await tokens.issue(booking);
    await collections(t.db).bookings.updateOne(
      { _id: booking._id },
      { $set: { status: 'cancelled_by_owner' } },
    );
    expect((await cancel(token).expect(409)).body).toMatchObject({ code: 'not_cancellable' });
  });

  it('verlangt die ausdrückliche Bestätigung', async () => {
    const { booking } = await groupBooking();
    const token = await tokens.issue(booking);
    await cancel(token, {}).expect(400);
    await cancel(token, { confirm: 'true' }).expect(400);
    expect((await collections(t.db).bookings.findOne({ _id: booking._id }))?.status).toBe(
      'confirmed',
    );
  });

  it('macht den Platz für andere wieder buchbar', async () => {
    const { booking, session } = await groupBooking();
    await collections(t.db).sessions.updateOne(
      { _id: session._id },
      { $set: { capacity: 2, bookedCount: 1 } },
    );
    await cancel(await tokens.issue(booking)).expect(200);
    await http()
      .post(`${base}/bookings`)
      .send({
        type: 'group',
        sessionId: session._id.toHexString(),
        participant: participant(),
        idempotencyKey: 'self-service-rebook-after-cancel',
        privacyAccepted: true,
      })
      .expect(201);
  });
});
