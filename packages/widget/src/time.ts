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
