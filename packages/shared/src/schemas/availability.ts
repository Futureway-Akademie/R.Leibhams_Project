import { z } from 'zod';
import { availabilityExceptionKindSchema, isoWeekdaySchema } from '../enums.js';
import {
  localDateSchema,
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

// Feldformen ohne Standardwerte, damit Teiländerungen keine Defaults setzen (siehe service.ts).
const courseRuleShape = {
  weekdays: z
    .array(isoWeekdaySchema)
    .min(1)
    .refine((d) => new Set(d).size === d.length, 'Wochentage dürfen nicht doppelt vorkommen'),
  startTime: unitLocalTimeSchema.refine((t) => t !== '24:00', 'Ungültige Startzeit'),
  validFrom: localDateSchema,
  validUntil: localDateSchema.nullable(),
  capacity: groupCapacitySchema.nullable(),
  location: z.string().trim().max(200).nullable(),
};

const validRange = (r: {
  validFrom?: string | undefined;
  validUntil?: string | null | undefined;
}) => !r.validFrom || !r.validUntil || r.validFrom <= r.validUntil;
const validRangeIssue = {
  message: 'Gültig bis muss am oder nach Gültig ab liegen',
  path: ['validUntil'],
};

/** Wiederkehrende Regel, aus der Kurstermine im Buchungshorizont erzeugt werden. */
export const courseRuleFields = z
  .object({
    serviceId: objectIdSchema,
    ...courseRuleShape,
    validUntil: courseRuleShape.validUntil.default(null),
    capacity: courseRuleShape.capacity.default(null),
    location: courseRuleShape.location.default(null),
  })
  .refine(validRange, validRangeIssue);

/** Teiländerung einer Kursregel; das Angebot ist nicht änderbar. */
export const courseRulePatchSchema = z
  .strictObject(courseRuleShape)
  .partial()
  .refine(validRange, validRangeIssue);

export const courseRuleSchema = z.intersection(courseRuleFields, z.object({ id: objectIdSchema }));
export type CourseRule = z.infer<typeof courseRuleSchema>;

/** Ergebnis einer (erneuten) Erzeugung von Kursterminen aus einer Regel. */
export const courseGenerationReportSchema = z.object({
  created: z.int().nonnegative(),
  /** Lokale Beginne, die wegen Überschneidung mit belegter Zeit übersprungen wurden. */
  conflicts: z.array(z.string()),
  /** Künftige Termine mit Buchungen, die bei einer Regeländerung unverändert blieben. */
  keptWithBookings: z.array(z.string()),
});
export type CourseGenerationReport = z.infer<typeof courseGenerationReportSchema>;

export const courseRuleResultSchema = z.object({
  rule: courseRuleSchema,
  generation: courseGenerationReportSchema,
});
export type CourseRuleResult = z.infer<typeof courseRuleResultSchema>;

/** Installationsweite Einstellungen, die für Verfügbarkeiten relevant sind. */
export const installationSettingsSchema = z.object({
  timeZone: timeZoneSchema,
});
export type InstallationSettings = z.infer<typeof installationSettingsSchema>;
