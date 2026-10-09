// Lokale Daten und Uhrzeiten der Installation (ohne Zeitzone). Für Rechnung und Anzeige werden
// sie als UTC-Zeitpunkte behandelt, damit die Zeitzone des Geräts keine Rolle spielt.
import { OCCUPANCY_UNIT_MINUTES } from '@fw-booking/shared';

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof ISO_WEEKDAYS)[number];

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
  6: 'Samstag',
  7: 'Sonntag',
};

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM` (00:00–23:59). */
export function isTime(value: string): boolean {
  return TIME.test(value);
}

/** Gültiges Kalenderdatum `YYYY-MM-DD`. */
export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function isOnGrid(time: string): boolean {
  return Number(time.slice(-2)) % OCCUPANCY_UNIT_MINUTES === 0;
}

/** Datum plus Tage, z. B. für das Ende ganztägiger Ausnahmen (00:00 am Folgetag). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Heutiges Datum in der Zeitzone der Installation. */
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA liefert YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** „Mo., 21.12.2026“ */
export function formatLocalDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

/** Zeitraum einer Ausnahme (lokal, Ende ausschließlich) lesbar. */
export function formatLocalRange(start: string, end: string): string {
  const [startDate = '', startTime = ''] = start.split('T');
  const [endDate = '', endTime = ''] = end.split('T');
  if (startTime === '00:00' && endTime === '00:00') {
    const lastDay = addDays(endDate, -1);
    return lastDay === startDate
      ? `${formatLocalDate(startDate)}, ganztägig`
      : `${formatLocalDate(startDate)} – ${formatLocalDate(lastDay)}, ganztägig`;
  }
  if (startDate === endDate) {
    return `${formatLocalDate(startDate)}, ${startTime}–${endTime} Uhr`;
  }
  if (endTime === '00:00' && addDays(startDate, 1) === endDate) {
    return `${formatLocalDate(startDate)}, ${startTime}–24:00 Uhr`;
  }
  return `${formatLocalDate(startDate)}, ${startTime} Uhr – ${formatLocalDate(endDate)}, ${endTime} Uhr`;
}
