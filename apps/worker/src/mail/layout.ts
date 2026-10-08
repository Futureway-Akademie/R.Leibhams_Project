// Gemeinsames Gerüst aller Mails: Bausteine werden einmal beschrieben und daraus Text und HTML
// erzeugt. Alle Werte werden im HTML maskiert; Zeilenumbrüche aus Eingaben werden entfernt.
import { formatDate, formatTimeRange } from '@fw-booking/shared';

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
export const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

export interface Contact {
  businessName: string;
  businessPhone: string | null;
  replyTo: string | null;
}

export interface Appointment {
  serviceTitle: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  location: string | null;
}

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'details'; heading?: string; rows: [string, string][] }
  | { kind: 'action'; intro: string; label: string; url: string }
  | { kind: 'note'; text: string };

export interface MailLayout {
  subject: string;
  participantName: string;
  blocks: Block[];
  contact: Contact;
}

const iso = (date: Date) => date.toISOString();

/** Datum eines Termins in der Zeitzone der Installation, z. B. „Mi., 14. Okt. 2026“. */
export const appointmentDate = (a: Appointment) => formatDate(iso(a.startsAt), a.timeZone);

/** Angebot, Datum, Uhrzeit mit Zeitzone und – falls vorhanden – Ort. */
export function appointmentRows(a: Appointment, withService = true): [string, string][] {
  const time = formatTimeRange(iso(a.startsAt), iso(a.endsAt), a.timeZone);
  return [
    ...(withService ? ([['Angebot', oneLine(a.serviceTitle)]] as [string, string][]) : []),
    ['Datum', appointmentDate(a)],
    ['Uhrzeit', `${time} Uhr (Zeitzone ${a.timeZone})`],
    ...(a.location ? ([['Ort', oneLine(a.location)]] as [string, string][]) : []),
  ];
}

function contactLines(contact: Contact): string[] {
  return [
    oneLine(contact.businessName),
    ...(contact.businessPhone ? [`Telefon: ${oneLine(contact.businessPhone)}`] : []),
    ...(contact.replyTo ? [`E-Mail: ${contact.replyTo}`] : []),
  ];
}

function blockText(block: Block): string[] {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return [block.text];
    case 'details':
      return [
        ...(block.heading ? [`${block.heading}:`] : []),
        ...block.rows.map(([label, value]) => `${label}: ${value}`),
      ];
    case 'action':
      return [block.intro, block.url];
  }
}

const TH = 'padding:4px 16px 4px 0;font-weight:600;vertical-align:top';
const BUTTON =
  'display:inline-block;padding:10px 18px;background:#1a5fb4;color:#ffffff;text-decoration:none;border-radius:4px';

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p style="font-size:13px;color:#555">${escapeHtml(block.text)}</p>`;
    case 'details': {
      const rows = block.rows
        .map(
          ([label, value]) =>
            `<tr><th align="left" style="${TH}">${escapeHtml(label)}</th><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
        )
        .join('');
      const heading = block.heading
        ? `<p style="margin-bottom:4px"><strong>${escapeHtml(block.heading)}</strong></p>`
        : '';
      return `${heading}<table role="presentation" cellspacing="0" cellpadding="0">${rows}</table>`;
    }
    case 'action':
      return `<p>${escapeHtml(block.intro)}</p>\n<p><a href="${escapeHtml(block.url)}" style="${BUTTON}">${escapeHtml(block.label)}</a></p>`;
  }
}

export function renderMail(layout: MailLayout): { subject: string; text: string; html: string } {
  const subject = oneLine(layout.subject);
  const name = oneLine(layout.participantName);
  const contact = contactLines(layout.contact);

  const text = [
    `Hallo ${name},`,
    ...layout.blocks.flatMap((block) => ['', ...blockText(block)]),
    '',
    'Viele Grüße',
    ...contact,
    '',
    'Diese E-Mail wurde automatisch versendet.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;margin:0;padding:24px">
<p>Hallo ${escapeHtml(name)},</p>
${layout.blocks.map(blockHtml).join('\n')}
<p>Viele Grüße<br>${contact.map(escapeHtml).join('<br>')}</p>
<p style="font-size:12px;color:#777">Diese E-Mail wurde automatisch versendet.</p>
</body>
</html>`;

  return { subject, text, html };
}
