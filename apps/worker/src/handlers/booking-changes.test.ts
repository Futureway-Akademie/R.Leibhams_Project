import { collections, hashActionToken } from '@fw-booking/db';
import type { BookingDocument } from '@fw-booking/db';
import { MongoServerError, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { START, useMailHarness } from './test-harness.js';

const h = useMailHarness('worker_changes_test');

const icsOf = async (index = 0) =>
  (await h.mail(index)).attachments
    .find((a) => a.filename === 'termin.ics')
    ?.content.toString('utf8') ?? '';

/** Umgebuchtes Paar: alte Buchung zeigt auf die neue (wie RebookService). */
async function rebookedPair(
  newOverrides: Partial<BookingDocument> = {},
): Promise<{ old: BookingDocument; fresh: BookingDocument }> {
  const service = await h.singleService();
  const fresh = await h.booking(service._id, null, {
    startsAt: new Date(START.getTime() + 2 * 3_600_000),
    ...newOverrides,
  });
  const old = await h.booking(service._id, null, {
    status: 'rebooked',
    rebookedToBookingId: fresh._id,
    idempotencyKey: new ObjectId().toHexString(),
  });
  return { old, fresh };
}

describe('Stornomail', () => {
  it('bestätigt den Storno ohne Verwaltungslink, mit Link zum erneuten Buchen', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled' });
    const job = await h.job('booking_cancellation', booking);
    await h.setup().worker.processNext();

    expect(await h.reloadJob(job)).toMatchObject({ status: 'sent', result: 'sent' });
    const mail = await h.mail();
    expect(mail.subject).toMatch(/^Stornierung bestätigt: Haarschnitt am /);
    expect(mail.text).toContain('deine Buchung wurde wie gewünscht storniert.');
    expect(mail.text).toContain('Angebot: Haarschnitt');
    expect(mail.text).toContain('https://friseur.test/termine');
    expect(mail.text).not.toContain('#t=');
    expect(mail.messageId).toBe(`<${job._id.toHexString()}.booking_cancellation@friseur.test>`);
    expect(await collections(h.db).actionTokens.countDocuments()).toBe(0);

    const ics = await icsOf();
    expect(ics).toContain(`UID:booking-${booking._id.toHexString()}@friseur.test`);
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:1');
  });

  it('überspringt Aufträge, deren Buchung nicht storniert ist', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null);
    const job = await h.job('booking_cancellation', booking);
    await h.setup().worker.processNext();
    expect(await h.reloadJob(job)).toMatchObject({ status: 'sent', result: 'skipped' });
    expect(h.received).toHaveLength(0);
  });

  it('trifft nach einer Umbuchung den ursprünglichen Kalendereintrag', async () => {
    const { old, fresh } = await rebookedPair({ status: 'cancelled' });
    await h.job('booking_cancellation', fresh);
    await h.setup().worker.processNext();
    const ics = await icsOf();
    expect(ics).toContain(`UID:booking-${old._id.toHexString()}@friseur.test`);
    expect(ics).toContain('SEQUENCE:2');
  });
});

describe('Absagemail', () => {
  it('nennt die Begründung des Owners und den Ort des Kurstermins', async () => {
    const { service, session } = await h.groupSession();
    const booking = await h.booking(service._id, session, {
      status: 'cancelled_by_owner',
      ownerCancellationReason: 'Kursleitung <b>erkrankt</b>',
    });
    const job = await h.job('owner_cancellation', booking);
    await h.setup().worker.processNext();

    expect(await h.reloadJob(job)).toMatchObject({ status: 'sent', result: 'sent' });
    const mail = await h.mail();
    expect(mail.subject).toMatch(/^Terminabsage: Yoga am /);
    expect(mail.text).toContain('leider müssen wir deinen Termin absagen.');
    expect(mail.text).toContain('Ort: Studio 1');
    expect(mail.text).toContain('Grund: Kursleitung <b>erkrankt</b>');
    expect(mail.html).toContain('Grund: Kursleitung &lt;b&gt;erkrankt&lt;/b&gt;');
    expect(mail.text).toContain('Telefon: 030 123456');
    expect(mail.text).toContain(
      'Gern kannst du einen neuen Termin buchen:\nhttps://friseur.test/termine',
    );
    expect(mail.html).toContain('>Neuen Termin buchen</a>');
    expect(mail.text).not.toContain('#t=');
    expect(await icsOf()).toContain('STATUS:CANCELLED');
  });

  it('kommt ohne Begründung aus', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled_by_owner' });
    await h.job('owner_cancellation', booking);
    await h.setup().worker.processNext();
    expect((await h.mail()).text).not.toContain('Grund:');
  });

  it('überspringt Aufträge, deren Buchung nicht abgesagt ist', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled' });
    const job = await h.job('owner_cancellation', booking);
    await h.setup().worker.processNext();
    expect(await h.reloadJob(job)).toMatchObject({ result: 'skipped' });
    expect(h.received).toHaveLength(0);
  });

  it('erreicht bei einer Kursabsage jeden Teilnehmer mit eigener Mail', async () => {
    const { service, session } = await h.groupSession();
    for (const name of ['anna', 'ben', 'cem']) {
      const booking = await h.booking(service._id, session, {
        status: 'cancelled_by_owner',
        participant: { name, email: `${name}@example.test`, phone: '030 123456' },
        participantEmailKey: `${name}@example.test`,
      });
      await h.job('owner_cancellation', booking);
    }
    const { worker } = h.setup();
    while (await worker.processNext()) {
      // alle Aufträge abarbeiten
    }
    const recipients = await Promise.all([0, 1, 2].map(async (i) => (await h.mail(i)).to));
    expect(
      recipients.map((to) => (Array.isArray(to) ? to[0] : to)?.value[0]?.address).sort(),
    ).toEqual(['anna@example.test', 'ben@example.test', 'cem@example.test']);
  });
});

describe('Umbuchungsmail', () => {
  it('nennt bisherigen und neuen Termin und enthält einen neuen Link', async () => {
    const { old, fresh } = await rebookedPair();
    const job = await h.job('booking_rebooked', fresh);
    await h.setup().worker.processNext();

    expect(await h.reloadJob(job)).toMatchObject({ status: 'sent', result: 'sent' });
    const mail = await h.mail();
    expect(mail.subject).toMatch(/^Umbuchung bestätigt: Haarschnitt am /);
    const text = mail.text ?? '';
    expect(text.indexOf('Bisheriger Termin:')).toBeLessThan(text.indexOf('Neuer Termin:'));
    expect(text).toContain('kannst du den Termin über diesen Link stornieren:');
    expect(text).toContain('Eine weitere Umbuchung ist nicht möglich.');

    const token = /#t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
    const stored = await collections(h.db).actionTokens.findOne({
      tokenHash: hashActionToken(token),
    });
    expect(stored).toMatchObject({ bookingId: fresh._id, status: 'active' });
    expect(stored?.expiresAt).toEqual(fresh.endsAt);

    const ics = await icsOf();
    expect(ics).toContain(`UID:booking-${old._id.toHexString()}@friseur.test`);
    expect(ics).toContain('SEQUENCE:1');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('nennt bei Kursen den Ort beider Termine', async () => {
    const { service, session } = await h.groupSession('Studio 2');
    const fresh = await h.booking(service._id, session);
    const { session: oldSession } = await h.groupSession('Studio 1');
    await collections(h.db).sessions.updateOne(
      { _id: oldSession._id },
      { $set: { serviceId: service._id } },
    );
    await h.booking(service._id, oldSession, {
      status: 'rebooked',
      rebookedToBookingId: fresh._id,
      idempotencyKey: new ObjectId().toHexString(),
    });
    await h.job('booking_rebooked', fresh);
    await h.setup().worker.processNext();
    const text = (await h.mail()).text ?? '';
    expect(text.indexOf('Ort: Studio 1')).toBeLessThan(text.indexOf('Ort: Studio 2'));
  });

  it('überspringt die Mail, wenn die neue Buchung bereits storniert ist', async () => {
    const { fresh } = await rebookedPair({ status: 'cancelled' });
    const job = await h.job('booking_rebooked', fresh);
    await h.setup().worker.processNext();
    expect(await h.reloadJob(job)).toMatchObject({ status: 'sent', result: 'skipped' });
    expect(h.received).toHaveLength(0);
    expect(await collections(h.db).actionTokens.countDocuments()).toBe(0);
  });

  it('entfernt den neuen Link wieder, wenn der Versand scheitert', async () => {
    const { fresh } = await rebookedPair();
    const job = await h.job('booking_rebooked', fresh);
    h.rcptReply = { code: 451, message: 'später' };
    await h.setup().worker.processNext();
    expect(await h.reloadJob(job)).toMatchObject({
      status: 'pending',
      lastErrorCategory: 'smtp_deferred',
    });
    expect(await collections(h.db).actionTokens.countDocuments()).toBe(0);
  });
});

describe('Deduplizierung', () => {
  it('lässt je Buchung und Anlass nur einen Auftrag zu', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled' });
    await h.job('booking_cancellation', booking);
    await expect(h.job('booking_cancellation', booking)).rejects.toBeInstanceOf(MongoServerError);
    // Andere Anlässe derselben Buchung sind eigene Aufträge.
    await h.job('booking_confirmation', booking);
    expect(await collections(h.db).outboxJobs.countDocuments()).toBe(2);
  });

  it('versendet einen erledigten Auftrag nicht erneut', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled' });
    await h.job('booking_cancellation', booking);
    const { worker } = h.setup();
    expect(await worker.processNext()).toBe(true);
    expect(await worker.processNext()).toBe(false);
    expect(h.received).toHaveLength(1);
  });

  it('wiederholt nach einem Absturz mit derselben Message-ID', async () => {
    const service = await h.singleService();
    const booking = await h.booking(service._id, null, { status: 'cancelled_by_owner' });
    const job = await h.job('owner_cancellation', booking);
    const { worker } = h.setup();
    await worker.processNext();
    // Absturz zwischen Versand und Abschluss nachstellen: Job wieder in Bearbeitung mit
    // abgelaufener Lease.
    await collections(h.db).outboxJobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'processing',
          leaseUntil: new Date(Date.now() - 1000),
          leaseToken: 'abgestuerzt',
        },
      },
    );
    await worker.processNext();
    expect(h.received).toHaveLength(2);
    const [first, second] = await Promise.all([h.mail(0), h.mail(1)]);
    expect(second.messageId).toBe(first.messageId);
    expect(first.messageId).toBe(`<${job._id.toHexString()}.owner_cancellation@friseur.test>`);
  });
});

describe('Logs', () => {
  it('enthalten keine Teilnehmerdaten, Begründungen oder Links', async () => {
    const { old, fresh } = await rebookedPair();
    await h.job('booking_rebooked', fresh);
    const service = await h.singleService();
    const absage = await h.booking(service._id, null, {
      status: 'cancelled_by_owner',
      ownerCancellationReason: 'Private Gründe der Inhaberin',
    });
    await h.job('owner_cancellation', absage);
    const { worker, logs } = h.setup();
    while (await worker.processNext()) {
      // alle Aufträge abarbeiten
    }
    const output = logs.join('');
    expect(output).toContain('booking_rebooked');
    expect(output).toContain('owner_cancellation');
    for (const secret of [
      'erika@example.test',
      'Erika Mustermann',
      '0301234567',
      '#t=',
      'Private Gründe',
      old._id.toHexString(),
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
