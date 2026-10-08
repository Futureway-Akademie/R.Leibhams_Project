// Gemeinsame Bausteine der Mail-Handler: Buchung samt Angebot laden, Kalender-UID und Frist
// bestimmen, Mail mit Kalenderdatei versenden und neu ausgestellte Links bei Fehlschlag entfernen.
import { SETTINGS_ID, collections, hashActionToken, issueActionToken } from '@fw-booking/db';
import type { BookingDocument, OutboxJobDocument, ServiceDocument } from '@fw-booking/db';
import type { Db } from 'mongodb';
import type { WorkerConfig } from '../config.js';
import { permanentFailure } from '../errors.js';
import type { BookingMailBase, MailContent } from '../mail/confirmation.js';
import type { Mailer } from '../mail/mailer.js';

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

export interface BookingContext {
  booking: BookingDocument;
  service: ServiceDocument;
  /** Buchung, die durch Umbuchung zu dieser geführt hat (höchstens eine). */
  predecessor: BookingDocument | null;
  base: BookingMailBase;
  /** Letzter Zeitpunkt für Storno und Umbuchung über den Link. */
  changeDeadline: Date;
}

/** Lädt die Buchung des Jobs; fehlt sie, ist der Auftrag dauerhaft nicht ausführbar. */
export async function loadBooking(db: Db, job: OutboxJobDocument): Promise<BookingDocument> {
  if (!job.bookingId) throw permanentFailure('booking_missing');
  const booking = await collections(db).bookings.findOne({ _id: job.bookingId });
  if (!booking) throw permanentFailure('booking_missing');
  return booking;
}

export async function loadContext(
  db: Db,
  booking: BookingDocument,
  deps: MailHandlerDeps,
  now: Date,
): Promise<BookingContext> {
  const c = collections(db);
  const [service, session, settings, predecessor] = await Promise.all([
    c.services.findOne({ _id: booking.serviceId }),
    booking.sessionId ? c.sessions.findOne({ _id: booking.sessionId }) : null,
    c.settings.findOne({ _id: SETTINGS_ID }),
    c.bookings.findOne({ rebookedToBookingId: booking._id }),
  ]);
  if (!service) throw permanentFailure('service_missing');
  const deadlineMinutes =
    service.bookingRules.changeDeadlineMinutes ?? settings?.defaultChangeDeadlineMinutes ?? 0;
  return {
    booking,
    service,
    predecessor,
    changeDeadline: new Date(booking.startsAt.getTime() - deadlineMinutes * MINUTE_MS),
    base: {
      participantName: booking.participant.name,
      serviceTitle: service.title,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
      location: session?.location ?? null,
      businessName: deps.mail.businessName,
      businessPhone: deps.mail.businessPhone,
      replyTo: deps.mail.replyTo,
      domain: mailDomain(deps.mail.fromAddress),
      // Kalender-UID der ersten Buchung, damit Umbuchung und Absage denselben Eintrag treffen.
      calendarId: (predecessor ?? booking)._id.toHexString(),
      now,
    },
  };
}

/** Kurstermin-Ort einer anderen Buchung (z. B. des bisherigen Termins vor der Umbuchung). */
export async function locationOf(db: Db, booking: BookingDocument): Promise<string | null> {
  if (!booking.sessionId) return null;
  const session = await collections(db).sessions.findOne({ _id: booking.sessionId });
  return session?.location ?? null;
}

/** Stellt einen neuen Verwaltungslink aus. */
export async function newManageLink(
  db: Db,
  booking: BookingDocument,
  deps: MailHandlerDeps,
  now: Date,
): Promise<{ token: string; url: string }> {
  const token = await issueActionToken(db, booking, now);
  return { token, url: `${deps.mail.managePageUrl}#t=${token}` };
}

/**
 * Versendet die Mail mit Kalenderdatei und stabiler Message-ID je Job. Wurde für diese Mail ein
 * Link ausgestellt, wird er bei einem Fehlschlag wieder entfernt; der nächste Versuch stellt
 * einen neuen aus.
 */
export async function sendBookingMail(
  db: Db,
  deps: MailHandlerDeps,
  job: OutboxJobDocument,
  booking: BookingDocument,
  content: MailContent,
  issuedToken: string | null = null,
): Promise<'sent'> {
  try {
    await deps.mailer.send({
      to: booking.participant.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      messageId: `<${job._id.toHexString()}.${job.type}@${mailDomain(deps.mail.fromAddress)}>`,
      ...(content.ics
        ? {
            attachments: [
              {
                filename: 'termin.ics',
                content: content.ics,
                contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
              },
            ],
          }
        : {}),
    });
  } catch (error) {
    if (issuedToken) {
      await collections(db).actionTokens.deleteOne({ tokenHash: hashActionToken(issuedToken) });
    }
    throw error;
  }
  return 'sent';
}
