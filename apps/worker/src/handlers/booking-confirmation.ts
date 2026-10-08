// Bestätigungsmail nach einer Buchung (task-3-2): lädt Buchung, Angebot und Kurstermin, stellt
// einen neuen Verwaltungslink aus und versendet die Mail. Nicht mehr aktive Buchungen werden
// übersprungen; über Storno, Umbuchung oder Absage informieren eigene Mails.
import { SETTINGS_ID, collections, hashActionToken, issueActionToken } from '@fw-booking/db';
import type { WorkerConfig } from '../config.js';
import { permanentFailure } from '../errors.js';
import { confirmationMail } from '../mail/confirmation.js';
import type { Mailer } from '../mail/mailer.js';
import type { JobHandler } from '../worker.js';

const MINUTE_MS = 60_000;

export interface MailHandlerDeps {
  mailer: Mailer;
  mail: WorkerConfig['mail'];
  now?: () => Date;
}

/** Domain der Absenderadresse, z. B. für Message-ID und Kalender-UID. */
export function mailDomain(fromAddress: string): string {
  return fromAddress.split('@')[1]?.toLowerCase() ?? 'localhost';
}

export function bookingConfirmationHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const c = collections(db);
    if (!job.bookingId) throw permanentFailure('booking_missing');
    const booking = await c.bookings.findOne({ _id: job.bookingId });
    if (!booking) throw permanentFailure('booking_missing');
    if (booking.status !== 'confirmed') return 'skipped';

    const [service, session, settings] = await Promise.all([
      c.services.findOne({ _id: booking.serviceId }),
      booking.sessionId ? c.sessions.findOne({ _id: booking.sessionId }) : null,
      c.settings.findOne({ _id: SETTINGS_ID }),
    ]);
    if (!service) throw permanentFailure('service_missing');
    const deadlineMinutes =
      service.bookingRules.changeDeadlineMinutes ?? settings?.defaultChangeDeadlineMinutes ?? 0;

    const token = await issueActionToken(db, booking, now);
    const domain = mailDomain(deps.mail.fromAddress);
    const content = confirmationMail({
      bookingId: booking._id.toHexString(),
      participantName: booking.participant.name,
      serviceTitle: service.title,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
      location: session?.location ?? null,
      changeDeadline: new Date(booking.startsAt.getTime() - deadlineMinutes * MINUTE_MS),
      manageUrl: `${deps.mail.managePageUrl}#t=${token}`,
      businessName: deps.mail.businessName,
      businessPhone: deps.mail.businessPhone,
      replyTo: deps.mail.replyTo,
      domain,
      now,
    });

    try {
      await deps.mailer.send({
        to: booking.participant.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        messageId: `<${job._id.toHexString()}.${job.type}@${domain}>`,
        attachments: [
          {
            filename: 'termin.ics',
            content: content.ics,
            contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
          },
        ],
      });
    } catch (error) {
      // Nicht zugestellter Link: Token wieder entfernen, der nächste Versuch stellt einen neuen aus.
      await c.actionTokens.deleteOne({ tokenHash: hashActionToken(token) });
      throw error;
    }
    return 'sent';
  };
}
