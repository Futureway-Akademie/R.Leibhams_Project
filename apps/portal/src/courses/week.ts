// Kalenderwochen (Montag–Sonntag) aus lokalen Daten der Installation.
import { addDays, isDate } from '../availability/time.js';

/** ISO-Wochentag eines lokalen Datums (1 = Montag … 7 = Sonntag). */
export function weekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Montag der Woche, in der `date` liegt. */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** ISO-Kalenderwoche, z. B. 42. */
export function isoWeekNumber(date: string): number {
  // Donnerstag derselben Woche bestimmt das Jahr der Kalenderwoche.
  const thursday = addDays(date, 4 - weekdayOf(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  const days =
    (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${yearStart}T00:00:00Z`)) / 86_400_000;
  return Math.floor(days / 7) + 1;
}

/** Woche aus der Adresse (`?woche=YYYY-MM-DD`), sonst die aktuelle; immer auf Montag normiert. */
export function weekFromParam(value: string | null, today: string): string {
  return startOfWeek(value && isDate(value) ? value : today);
}

const shortDate = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
});
const fullDate = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** „KW 42 · 12.10.–18.10.2026“ */
export function formatWeek(monday: string): string {
  const sunday = addDays(monday, 6);
  return `KW ${String(isoWeekNumber(monday))} · ${shortDate.format(new Date(`${monday}T00:00:00Z`))}–${fullDate.format(new Date(`${sunday}T00:00:00Z`))}`;
}
