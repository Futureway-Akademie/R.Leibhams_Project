import { z } from 'zod';
import { appointmentTypeSchema, bookingStatusSchema } from '../enums.js';
import { objectIdSchema, timeZoneSchema, utcDateTimeSchema } from '../primitives.js';

/** Pflichtangaben eines Teilnehmers (docs/domain-rules.md, Abschnitt 5.1). */
export const participantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().pipe(z.email()),
  phone: z
    .string()
    .trim()
    .regex(
      /^[0-9 +\-/()]{6,20}$/,
      'Erlaubt sind 6–20 Zeichen aus Ziffern, Leerzeichen und + - / ( )',
    )
    .refine((v) => /\d/.test(v), 'Telefonnummer muss Ziffern enthalten'),
});
export type Participant = z.infer<typeof participantSchema>;

/** Buchung, wie sie die API für angemeldete Owner zurückgibt. Enthält personenbezogene Daten. */
export const bookingSchema = z
  .object({
    id: objectIdSchema,
    serviceId: objectIdSchema,
    type: appointmentTypeSchema,
    /** Nur bei Gruppenkursen gesetzt. */
    sessionId: objectIdSchema.nullable(),
    startsAt: utcDateTimeSchema,
    endsAt: utcDateTimeSchema,
    timeZone: timeZoneSchema,
    status: bookingStatusSchema,
    participant: participantSchema,
    /** Nachfolgebuchung bei Status `rebooked`. */
    rebookedToBookingId: objectIdSchema.nullable(),
    /** Optionale Begründung einer Owner-Absage (für die Absagemail). */
    ownerCancellationReason: z.string().nullable(),
    createdAt: utcDateTimeSchema,
  })
  .refine((b) => (b.type === 'group') === (b.sessionId !== null), {
    message: 'sessionId ist genau bei Gruppenkursen gesetzt',
    path: ['sessionId'],
  })
  .refine((b) => (b.status === 'rebooked') === (b.rebookedToBookingId !== null), {
    message: 'rebookedToBookingId ist genau bei umgebuchten Buchungen gesetzt',
    path: ['rebookedToBookingId'],
  })
  .refine((b) => b.status === 'cancelled_by_owner' || b.ownerCancellationReason === null, {
    message: 'Eine Absagebegründung gibt es nur bei vom Owner abgesagten Buchungen',
    path: ['ownerCancellationReason'],
  });
export type Booking = z.infer<typeof bookingSchema>;
