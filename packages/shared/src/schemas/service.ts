import { z } from 'zod';
import {
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_SLOT_GRID_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  MIN_GROUP_CAPACITY,
  SLOT_GRID_MINUTES,
} from '../constants.js';
import { objectIdSchema, unitMinutesSchema, utcDateTimeSchema } from '../primitives.js';

export const durationMinutesSchema = unitMinutesSchema
  .min(MIN_DURATION_MINUTES)
  .max(MAX_DURATION_MINUTES);

export const bufferMinutesSchema = unitMinutesSchema.max(MAX_BUFFER_MINUTES);

export const slotGridMinutesSchema = z.union(SLOT_GRID_MINUTES.map((m) => z.literal(m)));

export const groupCapacitySchema = z.int().min(MIN_GROUP_CAPACITY);

// Feldformen ohne Standardwerte. Zod wendet Defaults auch innerhalb von `.partial()` an;
// Teiländerungen bauen deshalb auf diesen Formen auf, Neuanlagen auf den Varianten mit Defaults.
const bookingRulesShape = {
  minLeadMinutes: z.int().nonnegative().nullable(),
  horizonDays: z.int().min(1).max(730).nullable(),
  changeDeadlineMinutes: z.int().nonnegative().nullable(),
};

/** Angebotsbezogene Abweichungen von den Standardfristen; `null` bedeutet Standard der Installation. */
export const bookingRulesSchema = z.object({
  minLeadMinutes: bookingRulesShape.minLeadMinutes.default(null),
  horizonDays: bookingRulesShape.horizonDays.default(null),
  changeDeadlineMinutes: bookingRulesShape.changeDeadlineMinutes.default(null),
});
export type BookingRules = z.infer<typeof bookingRulesSchema>;

const serviceBaseShape = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
  durationMinutes: durationMinutesSchema,
};

const singleServiceShape = {
  ...serviceBaseShape,
  type: z.literal('single'),
  bufferMinutes: bufferMinutesSchema,
  slotGridMinutes: slotGridMinutesSchema,
};

const groupServiceShape = {
  ...serviceBaseShape,
  type: z.literal('group'),
  defaultCapacity: groupCapacitySchema,
};

const baseDefaults = {
  description: serviceBaseShape.description.default(null),
  active: serviceBaseShape.active.default(true),
  bookingRules: bookingRulesSchema.prefault({}),
};

/** Felder eines Einzeltermin-Angebots inklusive Standardwerten (für Neuanlage). */
export const singleServiceFields = z.object({
  ...singleServiceShape,
  ...baseDefaults,
  bufferMinutes: singleServiceShape.bufferMinutes.default(DEFAULT_BUFFER_MINUTES),
  slotGridMinutes: singleServiceShape.slotGridMinutes.default(DEFAULT_SLOT_GRID_MINUTES),
});

/** Felder eines Gruppenkurs-Angebots inklusive Standardwerten (für Neuanlage). */
export const groupServiceFields = z.object({ ...groupServiceShape, ...baseDefaults });

const bookingRulesPatch = z.object(bookingRulesShape).partial();

/** Teiländerung ohne Standardwerte; `type` ist Pflicht und bestimmt die erlaubten Felder. */
export const singleServicePatch = z
  .object({ ...singleServiceShape, bookingRules: bookingRulesPatch })
  .partial()
  .required({ type: true });
export const groupServicePatch = z
  .object({ ...groupServiceShape, bookingRules: bookingRulesPatch })
  .partial()
  .required({ type: true });

const serviceMeta = {
  id: objectIdSchema,
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
};

/** Angebot, wie es die API für Owner zurückgibt. */
export const serviceSchema = z.discriminatedUnion('type', [
  singleServiceFields.extend(serviceMeta),
  groupServiceFields.extend(serviceMeta),
]);
export type Service = z.infer<typeof serviceSchema>;
export type SingleService = Extract<Service, { type: 'single' }>;
export type GroupService = Extract<Service, { type: 'group' }>;
