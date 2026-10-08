// Inhalt der Erinnerung (task-3-4). Ohne Kalenderdatei: der Termin steht seit Bestätigung bzw.
// Umbuchung im Kalender, ein weiterer Anhang erzeugte in manchen Apps einen zweiten Eintrag.
import { LINK_NOTE, manageBlock } from './confirmation.js';
import type { ConfirmationData, MailContent } from './confirmation.js';
import { appointmentDate, appointmentRows, renderMail } from './layout.js';

export interface ReminderData extends ConfirmationData {
  /** Nach einer Umbuchung ist nur noch ein Storno möglich. */
  rebookAllowed: boolean;
}

export function reminderMail(data: ReminderData): MailContent {
  const mail = renderMail({
    subject: `Erinnerung: ${data.serviceTitle} am ${appointmentDate(data)}`,
    participantName: data.participantName,
    contact: data,
    blocks: [
      { kind: 'paragraph', text: 'wir erinnern dich an deinen bevorstehenden Termin.' },
      { kind: 'details', rows: appointmentRows(data) },
      manageBlock(data, data.rebookAllowed ? 'cancel_or_rebook' : 'cancel'),
      LINK_NOTE,
      { kind: 'paragraph', text: 'Wir freuen uns auf dich.' },
    ],
  });
  return { ...mail, ics: null };
}
