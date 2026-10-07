// Eingaben aus dem Owner-Portal. Regeln, die Datenbankzustand benötigen
// (z. B. Kapazität nicht unter gebuchte Plätze), prüft die API zusätzlich.
import { z } from 'zod';
import { objectIdSchema, utcDateTimeSchema } from '../primitives.js';
import {
  availabilityExceptionFields,
  courseRuleFields,
  weeklyOpeningHoursSchema,
} from './availability.js';
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

export const openingHoursUpdateSchema = z.strictObject({ days: weeklyOpeningHoursSchema });
export type OpeningHoursUpdate = z.infer<typeof openingHoursUpdateSchema>;

export const availabilityExceptionCreateSchema = availabilityExceptionFields;
export type AvailabilityExceptionCreate = z.infer<typeof availabilityExceptionCreateSchema>;

export const courseRuleCreateSchema = courseRuleFields;
export type CourseRuleCreate = z.infer<typeof courseRuleCreateSchema>;

/** Einzelner Kurstermin. Das Ende ergibt sich aus der Dauer des Angebots. */
export const sessionCreateSchema = z.strictObject({
  serviceId: objectIdSchema,
  startsAt: utcDateTimeSchema,
  capacity: groupCapacitySchema.nullable().default(null),
  location: z.string().trim().max(200).nullable().default(null),
});
export type SessionCreate = z.infer<typeof sessionCreateSchema>;

/** Absagen erfolgt über eine eigene Aktion, nicht über diese Änderung. */
export const sessionUpdateSchema = z.strictObject({
  startsAt: utcDateTimeSchema.optional(),
  capacity: groupCapacitySchema.optional(),
  location: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['scheduled', 'blocked']).optional(),
});
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;

/** Absage eines Kurstermins oder einer einzelnen Buchung durch den Owner. */
export const ownerCancellationSchema = z.strictObject({
  confirm: z.literal(true),
  reason: z.string().trim().max(500).nullable().default(null),
});
export type OwnerCancellation = z.infer<typeof ownerCancellationSchema>;
