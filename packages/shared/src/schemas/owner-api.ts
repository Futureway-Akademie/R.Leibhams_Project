// Eingaben aus dem Owner-Portal. Regeln, die Datenbankzustand benötigen
// (z. B. Kapazität nicht unter gebuchte Plätze), prüft die API zusätzlich.
import { z } from 'zod';
import { bookingStatusSchema } from '../enums.js';
import { OCCUPANCY_UNIT_MINUTES } from '../constants.js';
import { localDateSchema, objectIdSchema, utcDateTimeSchema } from '../primitives.js';
import {
  availabilityExceptionFields,
  courseRuleFields,
  courseRulePatchSchema,
  weeklyOpeningHoursSchema,
} from './availability.js';
import { bookingSchema } from './booking.js';
import { sessionSchema } from './session.js';
import {
  groupCapacitySchema,
  groupServiceFields,
  groupServicePatch,
  singleServiceFields,
  singleServicePatch,
} from './service.js';

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const serviceCreateSchema = z.discriminatedUnion('type', [
  singleServiceFields,
  groupServiceFields,
]);
export type ServiceCreate = z.infer<typeof serviceCreateSchema>;

/** Teiländerung eines Angebots. `type` muss angegeben werden und entscheidet über die erlaubten Felder. */
export const serviceUpdateSchema = z.discriminatedUnion('type', [
  singleServicePatch,
  groupServicePatch,
]);
export type ServiceUpdate = z.infer<typeof serviceUpdateSchema>;

/** Neue Reihenfolge der Angebote: alle IDs genau einmal, in gewünschter Reihenfolge. */
export const serviceOrderUpdateSchema = z.strictObject({
  serviceIds: z
    .array(objectIdSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'IDs dürfen nicht doppelt vorkommen'),
});
export type ServiceOrderUpdate = z.infer<typeof serviceOrderUpdateSchema>;

export const openingHoursUpdateSchema = z.strictObject({ days: weeklyOpeningHoursSchema });
export type OpeningHoursUpdate = z.infer<typeof openingHoursUpdateSchema>;

export const availabilityExceptionCreateSchema = availabilityExceptionFields;
export type AvailabilityExceptionCreate = z.infer<typeof availabilityExceptionCreateSchema>;

/** UTC-Zeitpunkt auf dem 5-Minuten-Raster (Belegungseinheiten). */
const unitUtcDateTimeSchema = utcDateTimeSchema.refine(
  (v) => Date.parse(v) % (OCCUPANCY_UNIT_MINUTES * 60_000) === 0,
  'Nur 5-Minuten-Schritte erlaubt',
);

/** Einzelner Kurstermin. Das Ende ergibt sich aus der Dauer des Angebots. */
export const sessionCreateSchema = z.strictObject({
  serviceId: objectIdSchema,
  startsAt: unitUtcDateTimeSchema,
  capacity: groupCapacitySchema.nullable().default(null),
  location: z.string().trim().max(200).nullable().default(null),
});
export type SessionCreate = z.infer<typeof sessionCreateSchema>;

/** Absagen erfolgt über eine eigene Aktion, nicht über diese Änderung. */
export const sessionUpdateSchema = z.strictObject({
  startsAt: unitUtcDateTimeSchema.optional(),
  capacity: groupCapacitySchema.optional(),
  location: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['scheduled', 'blocked']).optional(),
});
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;

export const sessionQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    serviceId: objectIdSchema.optional(),
    includeCancelled: z.enum(['true', 'false']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'to muss am oder nach from liegen',
    path: ['to'],
  });
export type SessionQuery = z.infer<typeof sessionQuerySchema>;

export const courseRuleCreateSchema = courseRuleFields;
export type CourseRuleCreate = z.infer<typeof courseRuleCreateSchema>;

export const courseRuleUpdateSchema = courseRulePatchSchema;
export type CourseRuleUpdate = z.infer<typeof courseRuleUpdateSchema>;

/** Absage eines Kurstermins oder einer einzelnen Buchung durch den Owner. */
export const ownerCancellationSchema = z.strictObject({
  confirm: z.literal(true),
  reason: z.string().trim().max(500).nullable().default(null),
});
export type OwnerCancellation = z.infer<typeof ownerCancellationSchema>;

/** Höchstens so viele Tage umfasst eine Buchungsübersicht. */
export const MAX_BOOKING_LIST_DAYS = 92;

/** Filter der Buchungsübersicht; ohne Zeitraum ab heute für 31 Tage. */
export const bookingQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    serviceId: objectIdSchema.optional(),
    sessionId: objectIdSchema.optional(),
    status: bookingStatusSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'to muss am oder nach from liegen',
    path: ['to'],
  })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      Date.parse(q.to) - Date.parse(q.from) < MAX_BOOKING_LIST_DAYS * 86_400_000,
    { message: `Höchstens ${String(MAX_BOOKING_LIST_DAYS)} Tage`, path: ['to'] },
  );
export type BookingQuery = z.infer<typeof bookingQuerySchema>;

/** Teilnehmerliste eines Kurstermins: alle Buchungen mit Status, älteste zuerst. */
export const sessionParticipantsSchema = z.object({
  session: sessionSchema,
  bookings: z.array(bookingSchema),
});
export type SessionParticipants = z.infer<typeof sessionParticipantsSchema>;

export const ownerBookingCancelResultSchema = z.object({
  booking: bookingSchema,
  /** Die Buchung war bereits vom Owner abgesagt; es wurde nichts geändert. */
  alreadyCancelled: z.boolean(),
});
export type OwnerBookingCancelResult = z.infer<typeof ownerBookingCancelResultSchema>;

export const sessionCancelResultSchema = z.object({
  session: sessionSchema,
  /** Anzahl der durch diese Absage abgesagten Buchungen. */
  cancelledBookings: z.int().nonnegative(),
  alreadyCancelled: z.boolean(),
});
export type SessionCancelResult = z.infer<typeof sessionCancelResultSchema>;

/** Öffentliche Kalenderkennung für die Einbindung des Widgets. */
export const ownerCalendarResponseSchema = z.object({
  calendarId: z.string().regex(/^cal_[A-Za-z0-9_-]{16,}$/),
  timeZone: z.string(),
});
export type OwnerCalendarResponse = z.infer<typeof ownerCalendarResponseSchema>;
