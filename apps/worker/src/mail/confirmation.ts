// Inhalt der Buchungsbestätigung (Text, HTML, Kalenderdatei). Reine Funktion ohne Datenbank,
// damit sich Inhalt und Maskierung einzeln prüfen lassen.
import { formatDate, formatDateTime, formatTimeRange } from '@fw-booking/shared';
import { buildIcs } from './ics.js';

export interface ConfirmationData {
  bookingId: string;
  participantName: string;
  serviceTitle: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  location: string | null;
  /** Letzter Zeitpunkt für Storno und Umbuchung über den Link. */
  changeDeadline: Date;
  /** Vollständiger Verwaltungslink mit Token im Fragment. */
  manageUrl: string;
  businessName: string;
  businessPhone: string | null;
  replyTo: string | null;
  /** Domain für Kalender-UID. */
  domain: string;
  now: Date;
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
  ics: string;
}

const iso = (date: Date) => date.toISOString();

/** Maskiert Daten für HTML; Teilnehmer- und Angebotsangaben stammen aus Eingaben. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Zeilenumbrüche entfernen, damit Werte keine Kopfzeilen oder Absätze einschleusen. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

export function confirmationMail(data: ConfirmationData): MailContent {
  const date = formatDate(iso(data.startsAt), data.timeZone);
  const time = formatTimeRange(iso(data.startsAt), iso(data.endsAt), data.timeZone);
  const deadline = formatDateTime(iso(data.changeDeadline), data.timeZone);
  const changeable = data.now <= data.changeDeadline;
  const name = oneLine(data.participantName);
  const title = oneLine(data.serviceTitle);
  const location = data.location ? oneLine(data.location) : null;
  const business = oneLine(data.businessName);

  const details: [string, string][] = [
    ['Angebot', title],
    ['Datum', date],
    ['Uhrzeit', `${time} Uhr (Zeitzone ${data.timeZone})`],
    ...(location ? ([['Ort', location]] as [string, string][]) : []),
  ];
  const changeText = changeable
    ? `Bis ${deadline} Uhr kannst du den Termin über diesen Link stornieren oder einmal umbuchen:`
    : 'Eine Änderung über den Link ist für diesen Termin nicht mehr möglich; bitte wende dich bei Fragen direkt an uns. Deine Buchung kannst du hier ansehen:';
  const contact = [
    business,
    ...(data.businessPhone ? [`Telefon: ${oneLine(data.businessPhone)}`] : []),
    ...(data.replyTo ? [`E-Mail: ${data.replyTo}`] : []),
  ];

  const subject = `Terminbestätigung: ${title} am ${date}`;

  const text = [
    `Hallo ${name},`,
    '',
    'vielen Dank für deine Buchung. Dein Termin ist bestätigt.',
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    changeText,
    data.manageUrl,
    '',
    'Bitte gib den Link nicht weiter; er ermöglicht Änderungen an deiner Buchung.',
    '',
    'Viele Grüße',
    ...contact,
    '',
    'Diese E-Mail wurde automatisch versendet.',
  ].join('\n');

  const rows = details
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:4px 16px 4px 0;font-weight:600">${escapeHtml(label)}</th><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;margin:0;padding:24px">
<p>Hallo ${escapeHtml(name)},</p>
<p>vielen Dank für deine Buchung. Dein Termin ist bestätigt.</p>
<table role="presentation" cellspacing="0" cellpadding="0">${rows}</table>
<p>${escapeHtml(changeText)}</p>
<p><a href="${escapeHtml(data.manageUrl)}" style="display:inline-block;padding:10px 18px;background:#1a5fb4;color:#ffffff;text-decoration:none;border-radius:4px">${changeable ? 'Buchung verwalten' : 'Buchung ansehen'}</a></p>
<p style="font-size:13px;color:#555">Bitte gib den Link nicht weiter; er ermöglicht Änderungen an deiner Buchung.</p>
<p>Viele Grüße<br>${contact.map(escapeHtml).join('<br>')}</p>
<p style="font-size:12px;color:#777">Diese E-Mail wurde automatisch versendet.</p>
</body>
</html>`;

  // Ohne Verwaltungslink: Kalender werden oft synchronisiert und geteilt.
  const ics = buildIcs({
    uid: `booking-${data.bookingId}@${data.domain}`,
    start: data.startsAt,
    end: data.endsAt,
    summary: `${title} – ${business}`,
    location,
    description: `Gebucht bei ${business}. Änderungen über den Link in der Bestätigungsmail.`,
    stamp: data.now,
  });

  return { subject, text, html, ics };
}
