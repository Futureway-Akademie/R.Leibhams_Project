// Umrechnung zwischen lokaler Zeit der Installation und UTC (docs/domain-rules.md, Abschnitt 8).
// Eingaben sind bereits validierte Strings; ungültige Formate führen zu einem RangeError.
import { Temporal } from 'temporal-polyfill';
import type { IsoWeekday } from '../enums.js';

export type LocalToUtcResult =
  | { ok: true; utc: string }
  /** Die lokale Zeit existiert wegen der Umstellung auf Sommerzeit nicht. */
  | { ok: false; reason: 'skipped' };

export interface LocalDateTimeParts {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  time: string;
  /** `YYYY-MM-DDTHH:MM` */
  dateTime: string;
  weekday: IsoWeekday;
}

export interface UtcRange {
  start: string;
  end: string;
}

function toUtcString(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: 'second' });
}

/**
 * Rechnet einen lokalen Zeitpunkt (`YYYY-MM-DDTHH:MM`) in UTC um.
 * Übersprungene Zeiten (Sommerzeitbeginn) liefern `skipped`; doppelte Zeiten
 * (Winterzeitbeginn) ergeben das erste Vorkommen.
 */
export function localToUtc(localDateTime: string, timeZone: string): LocalToUtcResult {
  const local = Temporal.PlainDateTime.from(localDateTime, { overflow: 'reject' });
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(local)) {
    return { ok: false, reason: 'skipped' };
  }
  return { ok: true, utc: toUtcString(zoned.toInstant()) };
}

/**
 * Wie `localToUtc`, aber für Grenzen von Zeitfenstern: Liegt die Grenze in einer übersprungenen
 * Stunde, gilt der Umstellungszeitpunkt (z. B. 02:30 am Sommerzeitbeginn → 03:00 Ortszeit).
 */
export function localBoundaryToUtc(localDateTime: string, timeZone: string): string {
  const local = Temporal.PlainDateTime.from(localDateTime, { overflow: 'reject' });
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (zoned.toPlainDateTime().equals(local)) return toUtcString(zoned.toInstant());
  const transition = zoned.getTimeZoneTransition('next');
  if (!transition) throw new RangeError('Keine Zeitumstellung gefunden');
  return toUtcString(transition.toInstant());
}

/** Zerlegt einen UTC-Zeitpunkt in lokale Datums- und Zeitangaben der Zeitzone. */
export function utcToLocal(utc: string, timeZone: string): LocalDateTimeParts {
  const zoned = Temporal.Instant.from(utc).toZonedDateTimeISO(timeZone);
  const date = zoned.toPlainDate().toString();
  const time = zoned.toPlainTime().toString({ smallestUnit: 'minute' });
  return { date, time, dateTime: `${date}T${time}`, weekday: zoned.dayOfWeek };
}

/** Beginn und Ende (exklusiv) eines lokalen Kalendertags in UTC. Ein Tag kann 23 oder 25 Stunden haben. */
export function localDayRangeUtc(localDate: string, timeZone: string): UtcRange {
  const day = Temporal.PlainDate.from(localDate, { overflow: 'reject' });
  return {
    start: toUtcString(day.toZonedDateTime({ timeZone }).toInstant()),
    end: toUtcString(day.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant()),
  };
}

/** Addiert echte Minuten auf einen UTC-Zeitpunkt, unabhängig von Zeitumstellungen. */
export function addMinutesUtc(utc: string, minutes: number): string {
  return toUtcString(Temporal.Instant.from(utc).add({ minutes }));
}

/** Echte Minuten zwischen zwei UTC-Zeitpunkten. */
export function minutesBetweenUtc(start: string, end: string): number {
  return Temporal.Instant.from(start).until(Temporal.Instant.from(end)).total('minutes');
}

export function addLocalDays(localDate: string, days: number): string {
  return Temporal.PlainDate.from(localDate, { overflow: 'reject' }).add({ days }).toString();
}

export function isoWeekdayOf(localDate: string): IsoWeekday {
  return Temporal.PlainDate.from(localDate, { overflow: 'reject' }).dayOfWeek;
}

/** Alle lokalen Daten von `from` bis einschließlich `to`. */
export function eachLocalDate(from: string, to: string): string[] {
  const end = Temporal.PlainDate.from(to, { overflow: 'reject' });
  const dates: string[] = [];
  for (
    let day = Temporal.PlainDate.from(from, { overflow: 'reject' });
    Temporal.PlainDate.compare(day, end) <= 0;
    day = day.add({ days: 1 })
  ) {
    dates.push(day.toString());
  }
  return dates;
}

/** Heutiges lokales Datum in der Zeitzone, bezogen auf einen UTC-Zeitpunkt (Standard: jetzt). */
export function localToday(
  timeZone: string,
  nowUtc: string = Temporal.Now.instant().toString(),
): string {
  return utcToLocal(nowUtc, timeZone).date;
}
