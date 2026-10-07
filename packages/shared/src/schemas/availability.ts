import { z } from 'zod';
import { availabilityExceptionKindSchema, isoWeekdaySchema } from '../enums.js';
import {
  localDateSchema,
  localTimeSchema,
  localTimeToMinutes,
  objectIdSchema,
  timeZoneSchema,
  unitLocalDateTimeSchema,
  unitLocalTimeSchema,
} from '../primitives.js';
import { groupCapacitySchema } from './service.js';

/** Zeitfenster innerhalb eines Tages in lokaler Zeit, auf dem 5-Minuten-Raster. */
export const timeWindowSchema = z
  .object({ start: unitLocalTimeSchema, end: unitLocalTimeSchema })
  .refine((w) => localTimeToMinutes(w.start) < localTimeToMinutes(w.end), {
    message: 'Ende muss nach dem Beginn liegen',
    path: ['end'],
  });
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export const dayOpeningHoursSchema = z
  .object({ weekday: isoWeekdaySchema, windows: z.array(timeWindowSchema).min(1) })
  .refine(
    (day) => {
      const sorted = [...day.windows].sort(
        (a, b) => localTimeToMinutes(a.start) - localTimeToMinutes(b.start),
      );
      return sorted.every(
        (w, i) =>
          i === 0 ||
          localTimeToMinutes(sorted[i - 1]?.end ?? '00:00') <= localTimeToMinutes(w.start),
      );
    },
    { message: 'Zeitfenster eines Tages dürfen sich nicht überschneiden', path: ['windows'] },
  );
export type DayOpeningHours = z.infer<typeof dayOpeningHoursSchema>;

/** Wöchentliche Öffnungszeiten für Einzeltermine. Nicht aufgeführte Wochentage sind geschlossen. */
export const weeklyOpeningHoursSchema = z
  .array(dayOpeningHoursSchema)
  .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, {
    message: 'Jeder Wochentag darf nur einmal vorkommen',
  });
export type WeeklyOpeningHours = z.infer<typeof weeklyOpeningHoursSchema>;

/** Sperrzeit oder zusätzliche Öffnung in lokaler Zeit; hat Vorrang vor den Öffnungszeiten. */
export const availabilityExceptionFields = z
  .object({
    kind: availabilityExceptionKindSchema,
    start: unitLocalDateTimeSchema,
    end: unitLocalDateTimeSchema,
    note: z.string().trim().max(200).nullable().default(null),
  })
  .refine((e) => e.start < e.end, { message: 'Ende muss nach dem Beginn liegen', path: ['end'] });

export const availabilityExceptionSchema = z.intersection(
  availabilityExceptionFields,
  z.object({ id: objectIdSchema }),
);
export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

/** Antwort für den Wochenplan; die Zeitzone ist nur lesbar. */
export const openingHoursResponseSchema = z.object({
  timeZone: timeZoneSchema,
  days: weeklyOpeningHoursSchema,
});
export type OpeningHoursResponse = z.infer<typeof openingHoursResponseSchema>;

/** Zeitraum für die Liste der Ausnahmen (lokale Daten, jeweils einschließlich). */
export const availabilityExceptionQuerySchema = z
  .object({ from: localDateSchema.optional(), to: localDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'to muss am oder nach from liegen',
    path: ['to'],
  });
export type AvailabilityExceptionQuery = z.infer<typeof availabilityExceptionQuerySchema>;

export const availabilityExceptionCreatedSchema = z.object({
  exception: availabilityExceptionSchema,
  /** Bestätigte Buchungen im gesperrten Zeitraum; werden nicht automatisch abgesagt. */
  conflictingBookings: z.int().nonnegative(),
});
export type AvailabilityExceptionCreated = z.infer<typeof availabilityExceptionCreatedSchema>;

/** Wiederkehrende Regel, aus der Kurstermine im Buchungshorizont erzeugt werden. */
export const courseRuleFields = z
  .object({
    serviceId: objectIdSchema,
    weekdays: z
      .array(isoWeekdaySchema)
      .min(1)
      .refine((d) => new Set(d).size === d.length, 'Wochentage dürfen nicht doppelt vorkommen'),
    startTime: localTimeSchema.refine((t) => t !== '24:00', 'Ungültige Startzeit'),
    validFrom: localDateSchema,
    validUntil: localDateSchema.nullable().default(null),
    capacity: groupCapacitySchema.nullable().default(null),
    location: z.string().trim().max(200).nullable().default(null),
  })
  .refine((r) => r.validUntil === null || r.validFrom <= r.validUntil, {
    message: 'Gültig bis muss am oder nach Gültig ab liegen',
    path: ['validUntil'],
  });

export const courseRuleSchema = z.intersection(courseRuleFields, z.object({ id: objectIdSchema }));
export type CourseRule = z.infer<typeof courseRuleSchema>;

/** Installationsweite Einstellungen, die für Verfügbarkeiten relevant sind. */
export const installationSettingsSchema = z.object({
  timeZone: timeZoneSchema,
});
export type InstallationSettings = z.infer<typeof installationSettingsSchema>;
