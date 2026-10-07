import { serviceSchema } from '@fw-booking/shared';
import type { Service } from '@fw-booking/shared';
import { MongoServerError, ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { startReplSet } from '../testing/mongo.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;

const BASE = '/api/owner/services';
const haircut = { type: 'single', title: 'Herrenhaarschnitt', durationMinutes: 30 };
const yoga = {
  type: 'group',
  title: 'Yoga für Einsteiger',
  durationMinutes: 75,
  defaultCapacity: 12,
};

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
  await Promise.all([c.services.deleteMany({}), c.auditEvents.deleteMany({})]);
});

const http = () => request(t.app.getHttpServer());
const authed = {
  get: (url: string) => http().get(url).set('Cookie', owner.cookie),
  post: (url: string, body: object) =>
    http().post(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  patch: (url: string, body: object) =>
    http().patch(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
  put: (url: string, body: object) =>
    http().put(url).set('Cookie', owner.cookie).set('X-CSRF-Token', owner.csrfToken).send(body),
};

async function create(body: object): Promise<Service> {
  const response = await authed.post(BASE, body).expect(201);
  return serviceSchema.parse(response.body);
}

describe('Zugriffsschutz', () => {
  it('verlangt eine Owner-Sitzung', async () => {
    await http().get(BASE).expect(401);
    await http().post(BASE).send(haircut).expect(401);
  });

  it('verlangt das CSRF-Token beim Anlegen', async () => {
    await http().post(BASE).set('Cookie', owner.cookie).send(haircut).expect(403);
  });
});

describe('Angebote anlegen', () => {
  it('legt einen Einzeltermin mit Standardwerten an', async () => {
    const service = await create(haircut);
    expect(service).toMatchObject({
      type: 'single',
      title: 'Herrenhaarschnitt',
      durationMinutes: 30,
      bufferMinutes: 0,
      slotGridMinutes: 30,
      active: true,
      description: null,
      sortOrder: 0,
      bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
    });
    expect(service).not.toHaveProperty('defaultCapacity');
  });

  it('legt einen Gruppenkurs an und hängt ihn ans Ende', async () => {
    await create(haircut);
    const course = await create(yoga);
    expect(course).toMatchObject({ type: 'group', defaultCapacity: 12, sortOrder: 1 });
    expect(course).not.toHaveProperty('slotGridMinutes');
  });

  it.each([
    ['Gruppenkurs mit Kapazität 1', { ...yoga, defaultCapacity: 1 }],
    ['Einzeltermin mit Raster 15', { ...haircut, slotGridMinutes: 15 }],
    ['Dauer 32 Minuten', { ...haircut, durationMinutes: 32 }],
    ['unbekannte Terminart', { ...haircut, type: 'event' }],
  ])('lehnt ab: %s', async (_label, body) => {
    const response = await authed.post(BASE, body).expect(400);
    expect(response.body).toMatchObject({ message: 'Ungültige Eingabe' });
  });

  it('protokolliert das Anlegen', async () => {
    const service = await create(haircut);
    const event = await collections(t.db).auditEvents.findOne({ action: 'service.created' });
    expect(event).toMatchObject({ objectType: 'service', details: { type: 'single' } });
    expect(String(event?.objectId)).toBe(service.id);
  });
});

describe('Angebote lesen', () => {
  it('listet nach Reihenfolge und filtert nach Status', async () => {
    const a = await create(haircut);
    const b = await create(yoga);
    await authed.patch(`${BASE}/${a.id}`, { type: 'single', active: false }).expect(200);

    const all = (await authed.get(BASE).expect(200)).body as Service[];
    expect(all.map((s) => s.id)).toEqual([a.id, b.id]);
    const active = (await authed.get(`${BASE}?active=true`).expect(200)).body as Service[];
    expect(active.map((s) => s.id)).toEqual([b.id]);
    const inactive = (await authed.get(`${BASE}?active=false`).expect(200)).body as Service[];
    expect(inactive.map((s) => s.id)).toEqual([a.id]);
    await authed.get(`${BASE}?active=ja`).expect(400);
  });

  it('liefert ein einzelnes Angebot, 404 für unbekannte und 400 für ungültige IDs', async () => {
    const service = await create(yoga);
    expect((await authed.get(`${BASE}/${service.id}`).expect(200)).body).toEqual(service);
    await authed.get(`${BASE}/${new ObjectId().toHexString()}`).expect(404);
    await authed.get(`${BASE}/keine-id`).expect(400);
  });
});

describe('Angebote ändern', () => {
  it('ändert nur übermittelte Felder', async () => {
    const service = await create({ ...haircut, bookingRules: { minLeadMinutes: 120 } });
    const response = await authed
      .patch(`${BASE}/${service.id}`, {
        type: 'single',
        title: 'Haarschnitt kurz',
        bufferMinutes: 10,
      })
      .expect(200);
    const updated = serviceSchema.parse(response.body);
    expect(updated).toMatchObject({
      title: 'Haarschnitt kurz',
      bufferMinutes: 10,
      durationMinutes: 30,
      slotGridMinutes: 30,
      active: true,
      bookingRules: { minLeadMinutes: 120, horizonDays: null, changeDeadlineMinutes: null },
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(service.updatedAt));
  });

  it('ändert einzelne Fristen, ohne andere zurückzusetzen', async () => {
    const service = await create({
      ...yoga,
      bookingRules: { minLeadMinutes: 60, changeDeadlineMinutes: 720 },
    });
    const response = await authed
      .patch(`${BASE}/${service.id}`, { type: 'group', bookingRules: { horizonDays: 30 } })
      .expect(200);
    expect((response.body as Service).bookingRules).toEqual({
      minLeadMinutes: 60,
      horizonDays: 30,
      changeDeadlineMinutes: 720,
    });
  });

  it('erlaubt keinen Wechsel der Terminart', async () => {
    const service = await create(haircut);
    await authed.patch(`${BASE}/${service.id}`, { type: 'group', defaultCapacity: 5 }).expect(409);
    const unchanged = (await authed.get(`${BASE}/${service.id}`).expect(200)).body as Service;
    expect(unchanged.type).toBe('single');
  });

  it('validiert geänderte Werte', async () => {
    const service = await create(yoga);
    await authed.patch(`${BASE}/${service.id}`, { type: 'group', defaultCapacity: 1 }).expect(400);
    await authed.patch(`${BASE}/${service.id}`, { title: 'ohne Terminart' }).expect(400);
  });

  it('deaktiviert und reaktiviert und protokolliert beides ohne Werte', async () => {
    const service = await create(haircut);
    const off = await authed
      .patch(`${BASE}/${service.id}`, { type: 'single', active: false })
      .expect(200);
    expect((off.body as Service).active).toBe(false);
    await authed.patch(`${BASE}/${service.id}`, { type: 'single', active: true }).expect(200);

    const actions = await collections(t.db)
      .auditEvents.find({ objectType: 'service' }, { sort: { at: 1 } })
      .toArray();
    expect(actions.map((a) => a.action)).toEqual([
      'service.created',
      'service.deactivated',
      'service.reactivated',
    ]);
    expect(actions[1]?.details).toEqual({ fields: ['active'] });
  });

  it('liefert 404 für unbekannte Angebote', async () => {
    await authed
      .patch(`${BASE}/${new ObjectId().toHexString()}`, { type: 'single', title: 'x' })
      .expect(404);
  });
});

describe('Reihenfolge', () => {
  it('setzt die Reihenfolge aller Angebote', async () => {
    const a = await create(haircut);
    const b = await create(yoga);
    const c = await create({ ...haircut, title: 'Färben', durationMinutes: 90 });
    const response = await authed
      .put(`${BASE}/order`, { serviceIds: [c.id, a.id, b.id] })
      .expect(200);
    expect((response.body as Service[]).map((s) => [s.id, s.sortOrder])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
  });

  it('verlangt jedes Angebot genau einmal', async () => {
    const a = await create(haircut);
    const b = await create(yoga);
    await authed.put(`${BASE}/order`, { serviceIds: [a.id] }).expect(400);
    await authed.put(`${BASE}/order`, { serviceIds: [a.id, a.id] }).expect(400);
    await authed
      .put(`${BASE}/order`, { serviceIds: [a.id, new ObjectId().toHexString()] })
      .expect(400);
    const unchanged = (await authed.get(BASE).expect(200)).body as Service[];
    expect(unchanged.map((s) => s.id)).toEqual([a.id, b.id]);
  });
});

describe('Datenbank', () => {
  it('verlangt sortOrder für Angebote', async () => {
    const error = await collections(t.db)
      .services.insertOne({
        _id: new ObjectId(),
        type: 'single',
        title: 'ohne Reihenfolge',
        description: null,
        active: true,
        durationMinutes: 30,
        bufferMinutes: 0,
        slotGridMinutes: 30,
        bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).code).toBe(121);
  });
});
