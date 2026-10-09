// Kalendertage in der Zeitzone der Installation, nur mit Intl (kein Temporal im Widget).

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Lokales Datum `YYYY-MM-DD` eines UTC-Zeitpunkts in der angegebenen Zeitzone. */
export function localDate(utc: Date | string, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // en-CA liefert das ISO-Format YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(typeof utc === 'string' ? new Date(utc) : utc);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Kalendertag plus `days` Tage (zeitzonenunabhängig, rein auf dem Datum). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return result.toISOString().slice(0, 10);
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** Lokale Stunde (0–23) eines UTC-Zeitpunkts in der angegebenen Zeitzone. */
export function localHour(utc: string, timeZone: string): number {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFormatters.set(timeZone, formatter);
  }
  const hour = formatter.formatToParts(new Date(utc)).find((p) => p.type === 'hour')?.value;
  return Number(hour ?? 0);
}

/** Monat `YYYY-MM` eines Kalendertags. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Monat plus `months` Monate. */
export function addMonths(month: string, months: number): string {
  const [year, m] = month.split('-').map(Number);
  const result = new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1 + months, 1));
  return result.toISOString().slice(0, 7);
}

/** Erster und letzter Tag eines Monats. */
export function monthRange(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  return { first, last: addDays(`${addMonths(month, 1)}-01`, -1) };
}

/** Wochentag eines Kalendertags, Montag = 0 … Sonntag = 6. */
export function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return (new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay() + 6) % 7;
}
