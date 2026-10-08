// Kalenderdatei (iCalendar, RFC 5545) für einen Termin. Zeiten in UTC, damit jede
// Kalender-App sie in der Zeitzone des Geräts korrekt anzeigt.

export interface CalendarEvent {
  /** Global eindeutig und stabil je Buchung, damit Kalender Aktualisierungen zuordnen können. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location: string | null;
  description: string;
  stamp: Date;
}

/** z. B. 20261014T080000Z */
function utc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Maskiert Sonderzeichen in Textwerten. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Bricht Zeilen nach höchstens 75 Bytes um (Folgezeilen beginnen mit einem Leerzeichen). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FutureWay//WP Buchung Kalender plus//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utc(event.stamp)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    `DESCRIPTION:${escapeText(event.description)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
