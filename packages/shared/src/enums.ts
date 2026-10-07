import { z } from 'zod';

/** Terminart eines Angebots: Einzeltermin (Slots, Kapazität 1) oder Gruppenkurs. */
export const appointmentTypeSchema = z.enum(['single', 'group']);
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

/** Nur `confirmed` ist eine aktive Buchung. */
export const bookingStatusSchema = z.enum([
  'confirmed',
  'cancelled',
  'rebooked',
  'cancelled_by_owner',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Status eines Kurstermins. `blocked` nimmt keine neuen Buchungen an, belegt die Ressource aber weiter. */
export const sessionStatusSchema = z.enum(['scheduled', 'blocked', 'cancelled']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const availabilityExceptionKindSchema = z.enum(['closed', 'extra_opening']);
export type AvailabilityExceptionKind = z.infer<typeof availabilityExceptionKindSchema>;

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export const isoWeekdaySchema = z.int().min(1).max(7);
export type IsoWeekday = z.infer<typeof isoWeekdaySchema>;
