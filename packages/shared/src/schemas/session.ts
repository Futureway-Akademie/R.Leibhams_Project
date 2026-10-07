import { z } from 'zod';
import { sessionStatusSchema } from '../enums.js';
import { objectIdSchema, timeZoneSchema, utcDateTimeSchema } from '../primitives.js';
import { groupCapacitySchema } from './service.js';

/** Kurstermin eines Gruppenkurses, wie ihn die API für Owner zurückgibt. */
export const sessionSchema = z
  .object({
    id: objectIdSchema,
    serviceId: objectIdSchema,
    ruleId: objectIdSchema.nullable(),
    startsAt: utcDateTimeSchema,
    endsAt: utcDateTimeSchema,
    timeZone: timeZoneSchema,
    capacity: groupCapacitySchema,
    bookedCount: z.int().nonnegative(),
    status: sessionStatusSchema,
    location: z.string().nullable(),
  })
  .refine((s) => s.startsAt < s.endsAt, {
    message: 'Ende muss nach dem Beginn liegen',
    path: ['endsAt'],
  })
  .refine((s) => s.bookedCount <= s.capacity, {
    message: 'Mehr Buchungen als Kapazität',
    path: ['bookedCount'],
  });
export type Session = z.infer<typeof sessionSchema>;
