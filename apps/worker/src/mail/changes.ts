// Inhalte der Mails zu Storno, Umbuchung und Owner-Absage (task-3-3).
import { calendarFile, LINK_NOTE, manageBlock } from './confirmation.js';
import type { BookingMailBase, ConfirmationData, MailContent } from './confirmation.js';
import { appointmentDate, appointmentRows, oneLine, renderMail } from './layout.js';
import type { Appointment, Block } from './layout.js';

export interface CancellationData extends BookingMailBase {
  /** Seite zum erneuten Buchen (optional, BOOKING_PAGE_URL). */
  bookingPageUrl: string | null;
  /** Kalender-Version des abgesagten Termins (Bestätigung 0, nach Umbuchung 1). */
  sequence: number;
}

export interface OwnerCancellationData extends CancellationData {
  /** Optionale Begründung des Owners. */
  reason: string | null;
}

export interface RebookedData extends ConfirmationData {
  /** Bisheriger Termin; fehlt nur, wenn die alte Buchung nicht mehr existiert. */
  previous: Appointment | null;
}

function rebookBlock(url: string | null): Block[] {
  return url
    ? [
        {
          kind: 'action',
          intro: 'Gern kannst du einen neuen Termin buchen:',
          label: 'Neuen Termin buchen',
          url,
        },
      ]
    : [];
}

/** Bestätigung eines Stornos durch den Teilnehmer. Ohne Verwaltungslink (alle Links entwertet). */
export function cancellationMail(data: CancellationData): MailContent {
  const mail = renderMail({
    subject: `Stornierung bestätigt: ${data.serviceTitle} am ${appointmentDate(data)}`,
    participantName: data.participantName,
    contact: data,
    blocks: [
      { kind: 'paragraph', text: 'deine Buchung wurde wie gewünscht storniert.' },
      { kind: 'details', rows: appointmentRows(data) },
      ...rebookBlock(data.bookingPageUrl),
    ],
  });
  return { ...mail, ics: calendarFile(data, { sequence: data.sequence + 1, cancelled: true }) };
}

/** Absage durch den Owner, mit optionaler Begründung. */
export function ownerCancellationMail(data: OwnerCancellationData): MailContent {
  const reason = data.reason ? oneLine(data.reason) : null;
  const mail = renderMail({
    subject: `Terminabsage: ${data.serviceTitle} am ${appointmentDate(data)}`,
    participantName: data.participantName,
    contact: data,
    blocks: [
      { kind: 'paragraph', text: 'leider müssen wir deinen Termin absagen.' },
      { kind: 'details', rows: appointmentRows(data) },
      ...(reason ? ([{ kind: 'paragraph', text: `Grund: ${reason}` }] as Block[]) : []),
      {
        kind: 'paragraph',
        text: 'Wir bitten um Entschuldigung. Bei Fragen erreichst du uns über die unten genannten Kontaktdaten.',
      },
      ...rebookBlock(data.bookingPageUrl),
    ],
  });
  return { ...mail, ics: calendarFile(data, { sequence: data.sequence + 1, cancelled: true }) };
}

/** Bestätigung einer Umbuchung mit bisherigem und neuem Termin sowie neuem Verwaltungslink. */
export function rebookedMail(data: RebookedData): MailContent {
  const mail = renderMail({
    subject: `Umbuchung bestätigt: ${data.serviceTitle} am ${appointmentDate(data)}`,
    participantName: data.participantName,
    contact: data,
    blocks: [
      { kind: 'paragraph', text: 'dein Termin wurde erfolgreich umgebucht.' },
      ...(data.previous
        ? ([
            {
              kind: 'details',
              heading: 'Bisheriger Termin',
              rows: appointmentRows(data.previous, false),
            },
          ] as Block[])
        : []),
      { kind: 'details', heading: 'Neuer Termin', rows: appointmentRows(data) },
      manageBlock(data, 'cancel'),
      {
        kind: 'note',
        text: 'Eine weitere Umbuchung ist nicht möglich. Links aus früheren E-Mails gelten weiterhin für den neuen Termin.',
      },
      LINK_NOTE,
    ],
  });
  return { ...mail, ics: calendarFile(data, { sequence: 1 }) };
}
