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
import { durationMinutesSchema } from './service.js';

const publicServiceBase = {
  id: objectIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: durationMinutesSchema,
};

export const publicServiceSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...publicServiceBase, type: z.literal('single') }),
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
    /** Ausdrückliche Bestätigung der Datenschutzhinweise (Pflicht). */
    privacyAccepted: z.literal(true),
  }),
  z.strictObject({
    type: z.literal('group'),
    sessionId: objectIdSchema,
    participant: participantSchema,
    idempotencyKey: idempotencyKeySchema,
    privacyAccepted: z.literal(true),
  }),
]);
export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export type GroupBookingRequest = Extract<BookingRequest, { type: 'group' }>;
export type SingleBookingRequest = Extract<BookingRequest, { type: 'single' }>;

/** Fachliche Fehlercodes einer Buchungsanfrage, damit das Widget passende Meldungen zeigt. */
export const bookingErrorCodeSchema = z.enum([
  'session_full',
  'slot_taken',
  'not_bookable',
  'already_booked',
  'idempotency_conflict',
  'change_deadline_passed',
  'not_cancellable',
  'link_expired',
  'rebook_not_allowed',
  /** 429: zu viele Anfragen von dieser Verbindung (Retry-After beachten). */
  'rate_limited',
  /** 429: zu viele neue Buchungen mit dieser E-Mail-Adresse innerhalb einer Stunde. */
  'too_many_bookings',
  /** 403: die einbindende Website ist nicht freigegeben. */
  'origin_not_allowed',
]);
export type BookingErrorCode = z.infer<typeof bookingErrorCodeSchema>;

export const bookingErrorResponseSchema = z.object({
  statusCode: z.int(),
  message: z.string(),
  code: bookingErrorCodeSchema,
});
export type BookingErrorResponse = z.infer<typeof bookingErrorResponseSchema>;

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

/**
 * Header, in dem die Self-Service-Seite das Token aus dem Link-Fragment (`#t=…`) an die API
 * sendet. So erscheint das Token weder in URLs noch in Server-Logs oder Referrern.
 */
export const BOOKING_TOKEN_HEADER = 'x-booking-token';

/** Format eines Verwaltungs-Tokens (256 Bit, base64url). */
export const bookingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Ansicht der eigenen Buchung über den Verwaltungslink; ohne E-Mail und Telefon. */
export const selfServiceBookingSchema = z.strictObject({
  type: z.enum(['single', 'group']),
  serviceTitle: z.string(),
  participantName: z.string(),
  startsAt: utcDateTimeSchema,
  endsAt: utcDateTimeSchema,
  timeZone: timeZoneSchema,
  location: z.string().nullable(),
  status: bookingStatusSchema,
  /** Letzter Zeitpunkt für Storno und Umbuchung über den Link. */
  changeDeadline: utcDateTimeSchema,
  canCancel: z.boolean(),
  canRebook: z.boolean(),
});
export type SelfServiceBooking = z.infer<typeof selfServiceBookingSchema>;

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
