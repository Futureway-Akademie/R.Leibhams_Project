import { SETTINGS_ID, collections, hashActionToken } from '@fw-booking/db';
import type { BookingDocument } from '@fw-booking/db';
import { ObjectId } from 'mongodb';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ReminderScheduler, reminderDedupeKey } from '../reminders.js';
import { useMailHarness } from './test-harness.js';

const h = useMailHarness('worker_reminder_test');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const scheduler = () => new ReminderScheduler(h.db, pino({ level: 'silent' }));
const reminderJobs = () =>
  collections(h.db).outboxJobs.find({ type: 'booking_reminder' }).toArray();

/** Einzeltermin, der `startsIn` ab jetzt beginnt und vor `bookedAgo` gebucht wurde. */
async function bookingStarting(
  startsIn: number,
  bookedAgo = 3 * DAY,
  overrides: Partial<BookingDocument> = {},
): Promise<BookingDocument> {
  const service = await h.singleService();
  const startsAt = new Date(Math.floor((Date.now() + startsIn) / 300_000) * 300_000);
  return h.booking(service._id, null, {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    createdAt: new Date(Date.now() - bookedAgo),
    ...overrides,
  });
}

describe('Planung der Erinnerungen', () => {
  it('legt den Auftrag genau beim Erreichen des Vorlaufs an', async () => {
    const booking = await bookingStarting(30 * HOUR);
    const due = new Date(booking.startsAt.getTime() - DAY);
    expect(await scheduler().scan(new Date(due.getTime() - 60_000))).toBe(0);
    expect(await scheduler().scan(due)).toBe(1);

    const [job] = await reminderJobs();
    expect(job).toMatchObject({
      status: 'pending',
      bookingId: booking._id,
      dedupeKey: reminderDedupeKey(booking._id),
      scheduledFor: booking.startsAt,
      dueAt: due,
    });
  });

  it('erinnert nicht an Buchungen, die erst innerhalb des Fensters entstanden sind', async () => {
    await bookingStarting(10 * HOUR, 2 * HOUR);
    const early = await bookingStarting(10 * HOUR, 15 * HOUR);
    expect(await scheduler().scan()).toBe(1);
    expect((await reminderJobs()).map((j) => j.bookingId)).toEqual([early._id]);
  });

  it('erinnert nicht an stornierte, umgebuchte, abgesagte oder begonnene Termine', async () => {
    await bookingStarting(10 * HOUR, 3 * DAY, { status: 'cancelled' });
    await bookingStarting(10 * HOUR, 3 * DAY, {
      status: 'rebooked',
      rebookedToBookingId: new ObjectId(),
    });
    await bookingStarting(10 * HOUR, 3 * DAY, { status: 'cancelled_by_owner' });
    await bookingStarting(-HOUR);
    await bookingStarting(5 * DAY);
    expect(await scheduler().scan()).toBe(0);
  });

  it('legt je Buchung nur einen Auftrag an, auch bei gleichzeitigen Läufen', async () => {
    await bookingStarting(10 * HOUR);
    await bookingStarting(12 * HOUR);
    const created = await Promise.all(Array.from({ length: 5 }, () => scheduler().scan()));
    expect(created.reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(await scheduler().scan()).toBe(0);
    expect(await reminderJobs()).toHaveLength(2);
  });

  it('nutzt den Vorlauf aus den Installations-Einstellungen', async () => {
    await collections(h.db).settings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { reminderLeadMinutes: 48 * 60 } },
    );
    try {
      await bookingStarting(40 * HOUR);
      expect(await scheduler().scan()).toBe(1);
    } finally {
      await collections(h.db).settings.updateOne(
        { _id: SETTINGS_ID },
        { $set: { reminderLeadMinutes: 24 * 60 } },
      );
    }
  });
});

describe('Erinnerungsmail', () => {
  it('erinnert mit Termindetails und neuem Link, ohne Kalenderdatei', async () => {
    const booking = await bookingStarting(10 * HOUR);
    await collections(h.db).services.updateOne(
      { _id: booking.serviceId },
      { $set: { 'bookingRules.changeDeadlineMinutes': 120 } },
    );
    await scheduler().scan();
    const [job] = await reminderJobs();
    await h.setup().worker.processNext();

    expect(job && (await h.reloadJob(job))).toMatchObject({ status: 'sent', result: 'sent' });
    const mail = await h.mail();
    expect(mail.subject).toMatch(/^Erinnerung: Haarschnitt am /);
    expect(mail.text).toContain('wir erinnern dich an deinen bevorstehenden Termin.');
    expect(mail.text).toContain('stornieren oder einmal umbuchen:');
    expect(mail.attachments).toHaveLength(0);

    const token = /#t=([A-Za-z0-9_-]{43})/.exec(mail.text ?? '')?.[1] ?? '';
    expect(
      await collections(h.db).actionTokens.findOne({ tokenHash: hashActionToken(token) }),
    ).toMatchObject({ bookingId: booking._id, status: 'active' });
  });

  it('weist nach Ablauf der Änderungsfrist auf den direkten Kontakt hin', async () => {
    // Standard: Frist 24 Std., Erinnerung 24 Std. vorher → Frist abgelaufen.
    await bookingStarting(10 * HOUR);
    await scheduler().scan();
    await h.setup().worker.processNext();
    expect((await h.mail()).text).toContain('nicht mehr möglich');
  });

  it('erlaubt nach einer Umbuchung nur noch den Storno', async () => {
    const fresh = await bookingStarting(10 * HOUR);
    await collections(h.db).services.updateOne(
      { _id: fresh.serviceId },
      { $set: { 'bookingRules.changeDeadlineMinutes': 60 } },
    );
    await h.booking(fresh.serviceId, null, {
      status: 'rebooked',
      rebookedToBookingId: fresh._id,
      idempotencyKey: new ObjectId().toHexString(),
    });
    await scheduler().scan();
    await h.setup().worker.processNext();
    const text = (await h.mail()).text ?? '';
    expect(text).toContain('über diesen Link stornieren:');
    expect(text).not.toContain('umbuchen');
  });

  it.each([
    ['storniert', { status: 'cancelled' as const }],
    ['vom Owner abgesagt', { status: 'cancelled_by_owner' as const }],
    ['umgebucht', { status: 'rebooked' as const, rebookedToBookingId: new ObjectId() }],
  ])('überspringt Buchungen, die nach der Planung %s wurden', async (_label, change) => {
    const booking = await bookingStarting(10 * HOUR);
    await scheduler().scan();
    await collections(h.db).bookings.updateOne({ _id: booking._id }, { $set: change });
    await h.setup().worker.processNext();
    const [job] = await reminderJobs();
    expect(job).toMatchObject({ status: 'sent', result: 'skipped' });
    expect(h.received).toHaveLength(0);
    expect(await collections(h.db).actionTokens.countDocuments()).toBe(0);
  });

  it('überspringt verschobene und bereits begonnene Termine', async () => {
    const moved = await bookingStarting(10 * HOUR);
    const started = await bookingStarting(8 * HOUR);
    await scheduler().scan();
    await collections(h.db).bookings.updateOne(
      { _id: moved._id },
      {
        $set: {
          startsAt: new Date(moved.startsAt.getTime() + HOUR),
          endsAt: new Date(moved.endsAt.getTime() + HOUR),
        },
      },
    );
    await collections(h.db).bookings.updateOne(
      { _id: started._id },
      { $set: { startsAt: new Date(Date.now() - 60_000) } },
    );
    await collections(h.db).outboxJobs.updateMany(
      { bookingId: started._id },
      { $set: { scheduledFor: new Date(Date.now() - 60_000) } },
    );
    const { worker } = h.setup();
    while (await worker.processNext()) {
      // alle Aufträge abarbeiten
    }
    expect((await reminderJobs()).map((j) => j.result)).toEqual(['skipped', 'skipped']);
    expect(h.received).toHaveLength(0);
  });

  it('überspringt Kursbuchungen eines abgesagten Kurstermins', async () => {
    const { service, session } = await h.groupSession();
    await h.booking(service._id, session, {
      startsAt: new Date(Date.now() + 10 * HOUR),
      endsAt: new Date(Date.now() + 11 * HOUR),
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    await scheduler().scan();
    await collections(h.db).sessions.updateOne(
      { _id: session._id },
      { $set: { status: 'cancelled' } },
    );
    await h.setup().worker.processNext();
    expect((await reminderJobs())[0]).toMatchObject({ result: 'skipped' });
  });
});

describe('Planer im Betrieb', () => {
  it('plant beim Start sofort und beendet sich sauber', async () => {
    await bookingStarting(10 * HOUR);
    const s = new ReminderScheduler(h.db, pino({ level: 'silent' }), 60_000);
    s.start();
    await s.stop();
    expect(await reminderJobs()).toHaveLength(1);
  });
});
