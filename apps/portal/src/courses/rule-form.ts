// Formular für wiederkehrende Kursregeln (lokale Angaben ohne Zeitzone, wie in der API).
import { MIN_GROUP_CAPACITY } from '@fw-booking/shared';
import type { CourseRule, CourseRuleCreate, CourseRuleUpdate } from '@fw-booking/shared';
import { isDate, isOnGrid, isTime } from '../availability/time.js';

export interface RuleInput {
  serviceId: string;
  weekdays: number[];
  startTime: string;
  validFrom: string;
  /** Leer: unbefristet. */
  validUntil: string;
  /** Leer: Standardkapazität des Angebots. */
  capacity: string;
  location: string;
}

export type RuleField =
  'serviceId' | 'weekdays' | 'startTime' | 'validFrom' | 'validUntil' | 'capacity' | 'location';
export type RuleErrors = Partial<Record<RuleField, string>>;

export const RULE_FIELD_ORDER: readonly RuleField[] = [
  'serviceId',
  'weekdays',
  'startTime',
  'validFrom',
  'validUntil',
  'capacity',
  'location',
];

export function emptyRule(today: string): RuleInput {
  return {
    serviceId: '',
    weekdays: [],
    startTime: '18:00',
    validFrom: today,
    validUntil: '',
    capacity: '',
    location: '',
  };
}

export function ruleToInput(rule: CourseRule): RuleInput {
  return {
    serviceId: rule.serviceId,
    weekdays: [...rule.weekdays].sort((a, b) => a - b),
    startTime: rule.startTime,
    validFrom: rule.validFrom,
    validUntil: rule.validUntil ?? '',
    capacity: rule.capacity === null ? '' : String(rule.capacity),
    location: rule.location ?? '',
  };
}

export type RuleValidation =
  { ok: true; data: CourseRuleCreate } | { ok: false; errors: RuleErrors; firstError: RuleField };

export function validateRule(input: RuleInput): RuleValidation {
  const errors: RuleErrors = {};
  if (input.serviceId === '') errors.serviceId = 'Bitte einen Gruppenkurs wählen.';
  if (input.weekdays.length === 0) errors.weekdays = 'Bitte mindestens einen Wochentag wählen.';
  if (!isTime(input.startTime)) errors.startTime = 'Bitte eine Startzeit eingeben.';
  else if (!isOnGrid(input.startTime)) errors.startTime = 'Nur 5-Minuten-Schritte (z. B. 18:05).';
  if (!isDate(input.validFrom)) errors.validFrom = 'Bitte ein Datum eingeben.';
  if (input.validUntil !== '' && !isDate(input.validUntil)) {
    errors.validUntil = 'Bitte ein gültiges Datum eingeben oder leer lassen.';
  } else if (!errors.validFrom && input.validUntil !== '' && input.validUntil < input.validFrom) {
    errors.validUntil = 'Das Ende darf nicht vor dem Beginn liegen.';
  }
  let capacity: number | null = null;
  const capacityText = input.capacity.trim();
  if (capacityText !== '') {
    capacity = Number(capacityText);
    if (!Number.isInteger(capacity) || capacity < MIN_GROUP_CAPACITY) {
      errors.capacity = `Mindestens ${String(MIN_GROUP_CAPACITY)} Plätze oder leer lassen.`;
    }
  }
  const location = input.location.trim();
  if (location.length > 200) errors.location = 'Höchstens 200 Zeichen.';

  const firstError = RULE_FIELD_ORDER.find((field) => errors[field]);
  if (firstError) return { ok: false, errors, firstError };
  return {
    ok: true,
    data: {
      serviceId: input.serviceId,
      weekdays: [...input.weekdays].sort((a, b) => a - b),
      startTime: input.startTime,
      validFrom: input.validFrom,
      validUntil: input.validUntil === '' ? null : input.validUntil,
      capacity,
      location: location === '' ? null : location,
    },
  };
}

/** Teiländerung ohne Angebot (nicht änderbar); `null` ohne Änderung. */
export function rulePatch(original: CourseRule, data: CourseRuleCreate): CourseRuleUpdate | null {
  const patch: CourseRuleUpdate = {};
  const sortedOriginal = [...original.weekdays].sort((a, b) => a - b);
  if (sortedOriginal.join(',') !== data.weekdays.join(',')) patch.weekdays = data.weekdays;
  if (data.startTime !== original.startTime) patch.startTime = data.startTime;
  if (data.validFrom !== original.validFrom) patch.validFrom = data.validFrom;
  if (data.validUntil !== original.validUntil) patch.validUntil = data.validUntil;
  if (data.capacity !== original.capacity) patch.capacity = data.capacity;
  if (data.location !== original.location) patch.location = data.location;
  return Object.keys(patch).length > 0 ? patch : null;
}
