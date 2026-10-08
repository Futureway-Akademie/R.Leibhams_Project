// Inhalt der Buchungsbestätigung (Text, HTML, Kalenderdatei). Reine Funktion ohne Datenbank,
// damit sich Inhalt und Maskierung einzeln prüfen lassen.
import { formatDateTime } from '@fw-booking/shared';
import { buildIcs } from './ics.js';
import { appointmentDate, appointmentRows, oneLine, renderMail } from './layout.js';
import type { Appointment, Block, Contact } from './layout.js';

/** Gemeinsame Angaben aller Mails zu einer Buchung. */
export interface BookingMailBase extends Appointment, Contact {
  participantName: string;
  /** Domain für die Kalender-UID. */
  domain: string;
  /** Erste Buchung der Umbuchungskette; bestimmt die Kalender-UID. */
  calendarId: string;
  now: Date;
}

export interface ConfirmationData extends BookingMailBase {
  /** Letzter Zeitpunkt für Storno und Umbuchung über den Link. */
  changeDeadline: Date;
  /** Vollständiger Verwaltungslink mit Token im Fragment. */
  manageUrl: string;
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
  ics: string;
}

export const LINK_NOTE: Block = {
  kind: 'note',
  text: 'Bitte gib den Link nicht weiter; er ermöglicht Änderungen an deiner Buchung.',
};

/** Kalenderdatei ohne Verwaltungslink: Kalender werden oft synchronisiert und geteilt. */
export function calendarFile(
  data: BookingMailBase,
  options: { sequence: number; cancelled?: boolean },
): string {
  const business = oneLine(data.businessName);
  return buildIcs({
    uid: `booking-${data.calendarId}@${data.domain}`,
    start: data.startsAt,
    end: data.endsAt,
    summary: `${oneLine(data.serviceTitle)} – ${business}`,
    location: data.location ? oneLine(data.location) : null,
    description: options.cancelled
      ? `Abgesagt. Gebucht war bei ${business}.`
      : `Gebucht bei ${business}. Änderungen über den Link in der Bestätigungsmail.`,
    stamp: data.now,
    status: options.cancelled ? 'CANCELLED' : 'CONFIRMED',
    sequence: options.sequence,
  });
}

/** Hinweis auf die Änderungsfrist mit Verwaltungslink. */
export function manageBlock(
  data: Pick<ConfirmationData, 'changeDeadline' | 'manageUrl' | 'timeZone' | 'now'>,
  allowed: 'cancel_or_rebook' | 'cancel',
): Block {
  const deadline = formatDateTime(data.changeDeadline.toISOString(), data.timeZone);
  if (data.now > data.changeDeadline) {
    return {
      kind: 'action',
      intro:
        'Eine Änderung über den Link ist für diesen Termin nicht mehr möglich; bitte wende dich bei Fragen direkt an uns. Deine Buchung kannst du hier ansehen:',
      label: 'Buchung ansehen',
      url: data.manageUrl,
    };
  }
  const what = allowed === 'cancel_or_rebook' ? 'stornieren oder einmal umbuchen' : 'stornieren';
  return {
    kind: 'action',
    intro: `Bis ${deadline} Uhr kannst du den Termin über diesen Link ${what}:`,
    label: 'Buchung verwalten',
    url: data.manageUrl,
  };
}

export function confirmationMail(data: ConfirmationData): MailContent {
  const mail = renderMail({
    subject: `Terminbestätigung: ${data.serviceTitle} am ${appointmentDate(data)}`,
    participantName: data.participantName,
    contact: data,
    blocks: [
      { kind: 'paragraph', text: 'vielen Dank für deine Buchung. Dein Termin ist bestätigt.' },
      { kind: 'details', rows: appointmentRows(data) },
      manageBlock(data, 'cancel_or_rebook'),
      LINK_NOTE,
    ],
  });
  return { ...mail, ics: calendarFile(data, { sequence: 0 }) };
}
