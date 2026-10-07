// Öffentliche Schnittstelle für Widget und Self-Service-Seite.
// Antwortschemas sind strikt: zusätzliche Felder (etwa Teilnehmerdaten) führen zu einem Fehler.
import { z } from 'zod';
import { bookingStatusSchema } from '../enums.js';
import {
  idempotencyKeySchema,
  localDateSchema,
  objectIdSchema,
  timeZoneSchema,
  utcDateTimeSchema,
} from '../primitives.js';
import { participantSchema } from './booking.js';
import { durationMinutesSchema, slotGridMinutesSchema } from './service.js';

const publicServiceBase = {
  id: objectIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: durationMinutesSchema,
};

export const publicServiceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...publicServiceBase,
    type: z.literal('single'),
    slotGridMinutes: slotGridMinutesSchema,
  }),
  z.strictObject({ ...publicServiceBase, type: z.literal('group') }),
]);
export type PublicService = z.infer<typeof publicServiceSchema>;

export const publicServicesResponseSchema = z.strictObject({
  timeZone: timeZoneSchema,
  services: z.array(publicServiceSchema),
});
export type PublicServicesResponse = z.infer<typeof publicServicesResponseSchema>;

export const publicSlotSchema = z.strictObject({
  startsAt: utcDateTimeSchema,
  endsAt: utcDateTimeSchema,
});
export type PublicSlot = z.infer<typeof publicSlotSchema>;

export const publicSlotsResponseSchema = z.strictObject({
  serviceId: objectIdSchema,
  timeZone: timeZoneSchema,
  slots: z.array(publicSlotSchema),
});
export type PublicSlotsResponse = z.infer<typeof publicSlotsResponseSchema>;

/** Maximaler Zeitraum für die Übersicht freier Tage. */
export const MAX_AVAILABLE_DATES_RANGE_DAYS = 62;

export const slotsQuerySchema = z.object({ date: localDateSchema });
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const availableDatesQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((q) => q.from <= q.to, { message: 'to muss am oder nach from liegen', path: ['to'] })
  .refine(
    (q) =>
      (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1 <= MAX_AVAILABLE_DATES_RANGE_DAYS,
    { message: `Höchstens ${String(MAX_AVAILABLE_DATES_RANGE_DAYS)} Tage`, path: ['to'] },
  );
export type AvailableDatesQuery = z.infer<typeof availableDatesQuerySchema>;

/** Zeitraum für öffentliche Kurstermine; gleiche Grenzen wie bei freien Tagen. */
export const publicSessionsQuerySchema = availableDatesQuerySchema;
export type PublicSessionsQuery = AvailableDatesQuery;

/** Lokale Daten, an denen mindestens ein freier Slot existiert. */
export const availableDatesResponseSchema = z.strictObject({
  serviceId: objectIdSchema,
  timeZone: timeZoneSchema,
  dates: z.array(localDateSchema),
});
export type AvailableDatesResponse = z.infer<typeof availableDatesResponseSchema>;

export const publicSessionSchema = z.strictObject({
  id: objectIdSchema,
  serviceId: objectIdSchema,
  startsAt: utcDateTimeSchema,
  endsAt: utcDateTimeSchema,
  freeSeats: z.int().nonnegative(),
  location: z.string().nullable(),
});
export type PublicSession = z.infer<typeof publicSessionSchema>;

export const publicSessionsResponseSchema = z.strictObject({
  serviceId: objectIdSchema,
  timeZone: timeZoneSchema,
  sessions: z.array(publicSessionSchema),
});
export type PublicSessionsResponse = z.infer<typeof publicSessionsResponseSchema>;

/** Buchungsanfrage aus dem Widget. Einzeltermine nennen den Slot-Beginn, Kurse den Kurstermin. */
export const bookingRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('single'),
    serviceId: objectIdSchema,
    startsAt: utcDateTimeSchema,
    participant: participantSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    type: z.literal('group'),
    sessionId: objectIdSchema,
    participant: participantSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
]);
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

/** Antwort auf eine erfolgreiche Buchung. Der Verwaltungslink wird nur per E-Mail versendet. */
export const bookingConfirmationSchema = z.strictObject({
  bookingId: objectIdSchema,
  status: bookingStatusSchema,
  serviceTitle: z.string(),
  startsAt: utcDateTimeSchema,
  endsAt: utcDateTimeSchema,
  timeZone: timeZoneSchema,
});
export type BookingConfirmation = z.infer<typeof bookingConfirmationSchema>;

/** Storno über den Verwaltungslink erfordert eine ausdrückliche Bestätigung. */
export const selfServiceCancelRequestSchema = z.strictObject({ confirm: z.literal(true) });
export type SelfServiceCancelRequest = z.infer<typeof selfServiceCancelRequestSchema>;

/** Umbuchung innerhalb desselben Angebots, ebenfalls mit ausdrücklicher Bestätigung. */
export const selfServiceRebookRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('single'),
    startsAt: utcDateTimeSchema,
    confirm: z.literal(true),
  }),
  z.strictObject({ type: z.literal('group'), sessionId: objectIdSchema, confirm: z.literal(true) }),
]);
export type SelfServiceRebookRequest = z.infer<typeof selfServiceRebookRequestSchema>;
