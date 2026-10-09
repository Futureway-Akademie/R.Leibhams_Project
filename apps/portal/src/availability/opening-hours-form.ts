// Formularzustand des Wochenplans. Native Zeitfelder kennen kein `24:00`; „bis Mitternacht“ ist
// deshalb eine eigene Option je Zeitfenster.
import { openingHoursUpdateSchema } from '@fw-booking/shared';
import type { WeeklyOpeningHours } from '@fw-booking/shared';
import { ISO_WEEKDAYS, isOnGrid, isTime, timeToMinutes } from './time.js';
import type { Weekday } from './time.js';

export const MIDNIGHT = '24:00';

export interface WindowInput {
  start: string;
  end: string;
  untilMidnight: boolean;
}

export interface DayInput {
  open: boolean;
  /** Bleiben beim Schließen erhalten, damit erneutes Öffnen die Zeiten wiederherstellt. */
  windows: WindowInput[];
}

export type WeekInput = Record<Weekday, DayInput>;

export const DEFAULT_WINDOW: WindowInput = { start: '09:00', end: '17:00', untilMidnight: false };

/** Schlüssel für Meldungen: `3.0.start`, `3.0.end`, `3.day` (Überschneidung). */
export type WeekErrors = Record<string, string>;

export function weekToInput(days: WeeklyOpeningHours): WeekInput {
  const week = {} as WeekInput;
  for (const weekday of ISO_WEEKDAYS) {
    const day = days.find((d) => d.weekday === weekday);
    week[weekday] = day
      ? {
          open: true,
          windows: day.windows.map((w) =>
            w.end === MIDNIGHT
              ? { start: w.start, end: '', untilMidnight: true }
              : { start: w.start, end: w.end, untilMidnight: false },
          ),
        }
      : { open: false, windows: [] };
  }
  return week;
}

function endMinutes(window: WindowInput): number {
  return window.untilMidnight ? 24 * 60 : timeToMinutes(window.end);
}

export type WeekValidation =
  { ok: true; days: WeeklyOpeningHours } | { ok: false; errors: WeekErrors; firstError: string };

export function validateWeek(week: WeekInput): WeekValidation {
  const errors: WeekErrors = {};
  for (const weekday of ISO_WEEKDAYS) {
    const day = week[weekday];
    if (!day.open) continue;
    if (day.windows.length === 0) {
      errors[`${String(weekday)}.day`] =
        'Bitte mindestens ein Zeitfenster angeben oder den Tag schließen.';
      continue;
    }
    let windowsValid = true;
    for (const [index, window] of day.windows.entries()) {
      const key = `${String(weekday)}.${String(index)}`;
      if (!isTime(window.start)) {
        errors[`${key}.start`] = 'Bitte einen Beginn eingeben.';
      } else if (!isOnGrid(window.start)) {
        errors[`${key}.start`] = 'Nur 5-Minuten-Schritte (z. B. 09:05).';
      }
      if (!window.untilMidnight) {
        if (!isTime(window.end)) {
          errors[`${key}.end`] = 'Bitte ein Ende eingeben.';
        } else if (!isOnGrid(window.end)) {
          errors[`${key}.end`] = 'Nur 5-Minuten-Schritte (z. B. 17:55).';
        }
      }
      if (errors[`${key}.start`] || errors[`${key}.end`]) {
        windowsValid = false;
      } else if (timeToMinutes(window.start) >= endMinutes(window)) {
        errors[`${key}.end`] = 'Das Ende muss nach dem Beginn liegen.';
        windowsValid = false;
      }
    }
    if (windowsValid) {
      const sorted = [...day.windows].sort(
        (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start),
      );
      const overlaps = sorted.some(
        (window, index) =>
          index > 0 && endMinutes(sorted[index - 1] as WindowInput) > timeToMinutes(window.start),
      );
      if (overlaps) {
        errors[`${String(weekday)}.day`] = 'Die Zeitfenster dieses Tages überschneiden sich.';
      }
    }
  }

  const firstError = Object.keys(errors)[0];
  if (firstError !== undefined) return { ok: false, errors, firstError };

  const days: WeeklyOpeningHours = ISO_WEEKDAYS.filter((weekday) => week[weekday].open).map(
    (weekday) => ({
      weekday,
      windows: [...week[weekday].windows]
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
        .map((w) => ({ start: w.start, end: w.untilMidnight ? MIDNIGHT : w.end })),
    }),
  );
  // Zusätzliche Absicherung mit dem gemeinsamen Schema der API.
  const parsed = openingHoursUpdateSchema.safeParse({ days });
  if (!parsed.success) {
    return { ok: false, errors: { form: 'Der Wochenplan ist ungültig.' }, firstError: 'form' };
  }
  return { ok: true, days: parsed.data.days };
}

/** Überträgt Öffnung und Zeitfenster eines Tages auf andere Tage. */
export function copyDay(week: WeekInput, from: Weekday, to: readonly Weekday[]): WeekInput {
  const source = week[from];
  const next = { ...week };
  for (const weekday of to) {
    if (weekday === from) continue;
    next[weekday] = { open: source.open, windows: source.windows.map((w) => ({ ...w })) };
  }
  return next;
}

/** Vergleichbare Darstellung, um ungespeicherte Änderungen zu erkennen. */
export function weekSignature(week: WeekInput): string {
  return JSON.stringify(
    ISO_WEEKDAYS.map((weekday) => {
      const day = week[weekday];
      return day.open
        ? day.windows.map((w) => [w.start, w.untilMidnight ? MIDNIGHT : w.end])
        : null;
    }),
  );
}
