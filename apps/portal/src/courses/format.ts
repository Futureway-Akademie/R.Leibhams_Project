import { utcToLocal } from '@fw-booking/shared';
import type { CourseGenerationReport, CourseRule, Session } from '@fw-booking/shared';
import { formatLocalDate } from '../availability/time.js';
import { WEEKDAY_NAMES } from '../availability/time.js';
import type { Weekday } from '../availability/time.js';

export const SESSION_STATUS_LABELS: Record<Session['status'], string> = {
  scheduled: 'Geplant',
  blocked: 'Gesperrt',
  cancelled: 'Abgesagt',
};

/** „7 / 12 Plätze“ */
export function formatOccupancy(session: Pick<Session, 'bookedCount' | 'capacity'>): string {
  return `${String(session.bookedCount)} / ${String(session.capacity)} Plätze`;
}

export function isFull(session: Pick<Session, 'bookedCount' | 'capacity'>): boolean {
  return session.bookedCount >= session.capacity;
}

/** „Mo., 12.10.2026, 18:00“ aus einem lokalen Zeitpunkt `YYYY-MM-DDTHH:MM`. */
export function formatLocalDateTime(local: string): string {
  const [date = '', time = ''] = local.split('T');
  return `${formatLocalDate(date)}, ${time} Uhr`;
}

/** Lokaler Beginn eines Kurstermins in der Zeitzone der Installation. */
export function sessionLocalStart(session: Pick<Session, 'startsAt' | 'timeZone'>) {
  return utcToLocal(session.startsAt, session.timeZone);
}

const SHORT_WEEKDAYS: Record<Weekday, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};

/** „Mo, Mi · 18:00 Uhr · ab Mo., 02.11.2026 bis So., 20.12.2026“ */
export function ruleSummary(rule: CourseRule): string {
  const days = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map((d) => SHORT_WEEKDAYS[d as Weekday])
    .join(', ');
  const until = rule.validUntil ? ` bis ${formatLocalDate(rule.validUntil)}` : ', unbefristet';
  return `${days} · ${rule.startTime} Uhr · ab ${formatLocalDate(rule.validFrom)}${until}`;
}

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[day as Weekday];
}

/** Zusammenfassung eines Erzeugungsberichts in Sätzen. */
export function reportLines(report: CourseGenerationReport): {
  summary: string;
  conflicts: string[];
  kept: string[];
} {
  const created =
    report.created === 1
      ? '1 Kurstermin erzeugt.'
      : `${String(report.created)} Kurstermine erzeugt.`;
  return {
    summary: created,
    conflicts: report.conflicts.map(formatLocalDateTime),
    kept: report.keptWithBookings.map(formatLocalDateTime),
  };
}
