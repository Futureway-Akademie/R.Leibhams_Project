import { publicSlotsResponseSchema, availableDatesResponseSchema } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_ID, SETTINGS_ID, collections } from '../database/documents.js';
import type {
  GroupServiceDocument,
  OccupancyRefType,
  SingleServiceDocument,
} from '../database/documents.js';
import { createTestApp, loginAsOwner } from '../testing/app.js';
import type { OwnerSession, TestApp } from '../testing/app.js';
import { startReplSet } from '../testing/mongo.js';
import { SlotService } from './slot.service.js';

let replSet: MongoMemoryReplSet;
let t: TestApp;
let owner: OwnerSession;
let slotService: SlotService;

// Dienstag, 01.12.2026, Winterzeit (UTC+1). "Jetzt" liegt weit genug davor.
const DAY = '2026-12-01';
const NOW = new Date('2026-11-20T09:00:00Z');

beforeAll(async () => {
  replSet = await startReplSet();
  t = await createTestApp(replSet.getUri());
  owner = await loginAsOwner(t);
  slotService = t.app.get(SlotService);
});

afterAll(async () => {
  await t.close();
  await replSet.stop();
});

beforeEach(async () => {
  const c = collections(t.db);
  await Promise.all([
    c.services.deleteMany({}),
    c.openingHours.deleteMany({}),
    c.availabilityExceptions.deleteMany({}),
    c.resourceOccupancy.deleteMany({}),
  ]);
  await c.settings.updateOne({ _id: SETTINGS_ID }, { $set: { timeZone: 'Europe/Berlin' } });
  // Dienstag 09:00–12:00, Sonntag 01:00–04:00 (für die Zeitumstellung)
  await c.openingHours.insertMany([
    { _id: new ObjectId(), weekday: 2, windows: [{ start: '09:00', end: '12:00' }] },
    { _id: new ObjectId(), weekday: 7, windows: [{ start: '01:00', end: '04:00' }] },
  ]);
});

function single(overrides: Partial<SingleServiceDocument> = {}): SingleServiceDocument {
  return {
    _id: new ObjectId(),
    type: 'single',
    title: 'Haarschnitt',
    description: null,
    active: true,
    durationMinutes: 30,
    bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Lokale Startzeiten (Europe/Berlin) für gut lesbare Vergleiche. */
async function localStarts(
  service: SingleServiceDocument | GroupServiceDocument,
  date = DAY,
  now = NOW,
): Promise<string[]> {
  const slots = await slotService.slotsForDate(service, date, now);
  return slots.map((s) =>
    new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    }).format(s.startsAt),
  );
}

/** Lokale Uhrzeiten von `from` bis einschließlich `to` in 5-Minuten-Schritten. */
function times(from: string, to: string): string[] {
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const result: string[] = [];
  for (let m = toMinutes(from); m <= toMinutes(to); m += 5) {
    result.push(
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    );
  }
  return result;
}

/** Belegt die Ressource von `from` bis `to` (UTC) in 5-Minuten-Einheiten. */
async function occupy(from: string, to: string, refType: OccupancyRefType = 'booking') {
  const refId = new ObjectId();
  const units = [];
  for (let ms = Date.parse(from); ms < Date.parse(to); ms += 5 * 60_000) {
    units.push({
      _id: new ObjectId(),
      resourceId: DEFAULT_RESOURCE_ID,
      unitStart: new Date(ms),
      refType,
      refId,
    });
  }
  await collections(t.db).resourceOccupancy.insertMany(units);
}

describe('Startzeiten im 5-Minuten-Raster', () => {
  it('bietet jede Startzeit an, bei der die Dauer ins Fenster passt', async () => {
    // Fenster 09:00–12:00, Dauer 30 Minuten → 09:00, 09:05, … 11:30
    expect(await localStarts(single())).toEqual(times('09:00', '11:30'));
  });

  it('Bartrasur (20 Minuten) in einer freien Stunde 12–13 Uhr: 12:00 bis 12:40', async () => {
    await collections(t.db).openingHours.updateOne(
      { weekday: 2 },
      { $set: { windows: [{ start: '12:00', end: '13:00' }] } },
    );
    expect(await localStarts(single({ durationMinutes: 20 }))).toEqual(times('12:00', '12:40'));
  });

  it('verlangt, dass die Dauer ins Fenster passt', async () => {
    expect(await localStarts(single({ durationMinutes: 60 }))).toEqual(times('09:00', '11:00'));
  });

  it('setzt das Ende auf Beginn plus Dauer', async () => {
    const [first] = await slotService.slotsForDate(single(), DAY, NOW);
    expect(first?.startsAt.toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(first?.endsAt.toISOString()).toBe('2026-12-01T08:30:00.000Z');
  });

  it('berücksichtigt Sperrzeiten aus den Ausnahmen', async () => {
    await collections(t.db).availabilityExceptions.insertOne({
      _id: new ObjectId(),
      kind: 'closed',
      start: `${DAY}T10:00`,
      end: `${DAY}T11:00`,
      note: null,
      createdAt: NOW,
    });
    expect(await localStarts(single())).toEqual([
      ...times('09:00', '09:30'),
      ...times('11:00', '11:30'),
    ]);
  });
});

describe('Belegung der Ressource', () => {
  it('schließt belegte Zeiten aus (Termin belegt genau seine Dauer, ohne Puffer)', async () => {
    await occupy('2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z'); // 10:00–10:30 Ortszeit
    expect(await localStarts(single())).toEqual([
      ...times('09:00', '09:30'),
      ...times('10:30', '11:30'),
    ]);
  });

  it('bietet in Lücken nur Startzeiten an, bei denen die Dauer hineinpasst', async () => {
    await occupy('2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z'); // 10:00–10:30
    await occupy('2026-12-01T10:00:00Z', '2026-12-01T10:20:00Z'); // 11:00–11:20
    // Lücke 10:30–11:00 passt genau einmal, 11:20–12:00 ab 11:20 bis 11:30.
    expect(await localStarts(single())).toEqual([
      ...times('09:00', '09:30'),
      '10:30',
      ...times('11:20', '11:30'),
    ]);
  });

  it('blockiert auch durch Kurstermine (gemeinsame Ressource)', async () => {
    await occupy('2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', 'session'); // 11:00–12:00
    expect(await localStarts(single())).toEqual(times('09:00', '10:30'));
  });

  it('blockiert bei langen Terminen alle überlappenden Startzeiten', async () => {
    await occupy('2026-12-01T09:25:00Z', '2026-12-01T09:30:00Z'); // nur 10:25–10:30
    expect(await localStarts(single({ durationMinutes: 90 }))).toEqual(['10:30']);
  });
});

describe('Fristen', () => {
  it('wendet den Standard-Mindestvorlauf von 24 Stunden an', async () => {
    // Jetzt: 30.11. 10:10 Ortszeit → frühester Beginn 01.12. 10:10.
    const now = new Date('2026-11-30T09:10:00Z');
    expect(await localStarts(single(), DAY, now)).toEqual(times('10:10', '11:30'));
  });

  it('nutzt den Mindestvorlauf des Angebots', async () => {
    const now = new Date('2026-12-01T09:10:00Z'); // 10:10 Ortszeit am selben Tag
    const service = single({
      bookingRules: { minLeadMinutes: 0, horizonDays: null, changeDeadlineMinutes: null },
    });
    expect(await localStarts(service, DAY, now)).toEqual(times('10:10', '11:30'));
  });

  it('nutzt den Standard-Mindestvorlauf aus den Einstellungen', async () => {
    await collections(t.db).settings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { defaultMinLeadMinutes: 60 } },
    );
    const now = new Date('2026-12-01T08:10:00Z'); // 09:10 Ortszeit
    expect(await localStarts(single(), DAY, now)).toEqual(times('10:10', '11:30'));
    await collections(t.db).settings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { defaultMinLeadMinutes: 1440 } },
    );
  });

  it('wendet den Buchungshorizont an', async () => {
    const now = new Date('2026-09-01T09:00:00Z'); // 01.12. liegt 91 Tage später
    expect(await localStarts(single(), DAY, now)).toEqual([]);
    const shortHorizon = single({
      bookingRules: { minLeadMinutes: null, horizonDays: 7, changeDeadlineMinutes: null },
    });
    expect(await localStarts(shortHorizon)).toEqual([]);
  });
});

describe('Nicht buchbare Angebote', () => {
  it('liefert keine Slots für Gruppenkurse und deaktivierte Angebote', async () => {
    const group: GroupServiceDocument = {
      ...single(),
      type: 'group',
      defaultCapacity: 10,
    } as unknown as GroupServiceDocument;
    expect(await slotService.slotsForDate(group, DAY, NOW)).toEqual([]);
    expect(await localStarts(single({ active: false }))).toEqual([]);
  });

  it('liefert keine Slots an geschlossenen Tagen', async () => {
    expect(await localStarts(single(), '2026-12-02')).toEqual([]);
  });
});

describe('Zeitumstellung (Sonntag 01:00–04:00)', () => {
  it('Sommerzeitbeginn 29.03.2026: Startzeiten in der übersprungenen Stunde entfallen', async () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const slots = await slotService.slotsForDate(single(), '2026-03-29', now);
    const starts = slots.map((s) => s.startsAt.toISOString().slice(11, 16));
    // 01:00–01:55 MEZ (00:00Z–00:55Z), dann 03:00–03:30 MESZ (01:00Z–01:30Z).
    expect(starts).toEqual([...times('00:00', '00:55'), ...times('01:00', '01:30')]);
  });

  it('Winterzeitbeginn 25.10.2026: erstes Vorkommen, keine doppelten Startzeiten', async () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const slots = await slotService.slotsForDate(
      single({ durationMinutes: 60 }),
      '2026-10-25',
      now,
    );
    const utc = slots.map((s) => s.startsAt.toISOString());
    // 01:00–01:55 MESZ, 02:00–02:55 MESZ (erstes Vorkommen), 03:00 MEZ
    expect(utc[0]).toBe('2026-10-24T23:00:00.000Z');
    expect(utc).toContain('2026-10-25T00:55:00.000Z');
    expect(utc.at(-1)).toBe('2026-10-25T02:00:00.000Z');
    expect(utc).toHaveLength(12 + 12 + 1);
    // Das zweite Vorkommen der Stunde 02:00–02:55 (01:00Z–01:55Z) wird nicht angeboten.
    expect(utc.some((u) => u >= '2026-10-25T01:00' && u < '2026-10-25T02:00')).toBe(false);
    expect(new Set(utc).size).toBe(utc.length);
    expect(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 3_600_000)).toBe(true);
  });
});

describe('Freie Tage', () => {
  it('nennt nur Tage mit mindestens einem freien Slot', async () => {
    const service = single();
    // Dienstag 08.12. vollständig belegen (09:00–12:00 Ortszeit).
    await occupy('2026-12-08T08:00:00Z', '2026-12-08T11:00:00Z');
    expect(await slotService.availableDates(service, '2026-11-30', '2026-12-13', NOW)).toEqual([
      '2026-12-01',
      '2026-12-06',
      '2026-12-13',
    ]);
  });
});

describe('Owner-Endpunkte', () => {
  const http = () => request(t.app.getHttpServer());
  const authed = (url: string) => http().get(url).set('Cookie', owner.cookie);

  async function insert(service: SingleServiceDocument | GroupServiceDocument) {
    await collections(t.db).services.insertOne(service);
    return service._id.toHexString();
  }

  it('verlangt Anmeldung', async () => {
    const id = await insert(single());
    await http().get(`/api/owner/services/${id}/slots?date=${DAY}`).expect(401);
  });

  it('liefert Slots im öffentlichen Antwortformat', async () => {
    // Weit in der Zukunft liegt außerhalb des Horizonts; ein naher Tag hängt vom echten "jetzt" ab.
    // Daher: Mindestvorlauf 0 und den nächsten Dienstag ab heute verwenden.
    const id = await insert(
      single({ bookingRules: { minLeadMinutes: 0, horizonDays: 30, changeDeadlineMinutes: null } }),
    );
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + ((9 - next.getUTCDay()) % 7 || 7));
    const date = next.toISOString().slice(0, 10);
    const response = await authed(`/api/owner/services/${id}/slots?date=${date}`).expect(200);
    const body = publicSlotsResponseSchema.parse(response.body);
    expect(body.timeZone).toBe('Europe/Berlin');
    expect(body.slots).toHaveLength(31);
    const firstLocal = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(body.slots[0]?.startsAt ?? ''));
    expect(firstLocal).toBe('09:00');
  });

  it('liefert freie Tage', async () => {
    const id = await insert(
      single({ bookingRules: { minLeadMinutes: 0, horizonDays: 60, changeDeadlineMinutes: null } }),
    );
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const response = await authed(
      `/api/owner/services/${id}/available-dates?from=${from}&to=${to}`,
    ).expect(200);
    const body = availableDatesResponseSchema.parse(response.body);
    expect(body.dates.length).toBeGreaterThanOrEqual(5);
    // Nur Dienstage und Sonntage sind geöffnet.
    expect(body.dates.every((d) => [0, 2].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))).toBe(
      true,
    );
  });

  it('validiert Parameter und Angebot', async () => {
    const id = await insert(single());
    const group = await insert({
      ...single(),
      _id: new ObjectId(),
      type: 'group',
      defaultCapacity: 10,
    } as unknown as GroupServiceDocument);
    await authed(`/api/owner/services/${id}/slots`).expect(400);
    await authed(`/api/owner/services/${id}/slots?date=01.12.2026`).expect(400);
    await authed(`/api/owner/services/${group}/slots?date=${DAY}`).expect(400);
    await authed(`/api/owner/services/${new ObjectId().toHexString()}/slots?date=${DAY}`).expect(
      404,
    );
    await authed(`/api/owner/services/${id}/available-dates?from=2026-10-01&to=2026-12-31`).expect(
      400,
    );
  });
});
