// Formularzustand für Angebote: Eingaben als Text, Prüfung mit den gemeinsamen Schemas aus
// @fw-booking/shared, eigene deutsche Meldungen je Feld (Zod-Meldungen sind englisch und technisch).
import { serviceCreateSchema } from '@fw-booking/shared';
import type { BookingRules, Service, ServiceCreate, ServiceUpdate } from '@fw-booking/shared';
import type { ServiceType } from './format.js';

export type RuleKey = keyof BookingRules;

export interface RuleInput {
  /** `true`: Standard der Installation (`null`). */
  useDefault: boolean;
  /** Eingabe in Stunden (Vorlauf, Frist) bzw. Tagen (Horizont). */
  value: string;
}

export interface ServiceFormValues {
  type: ServiceType;
  title: string;
  description: string;
  durationMinutes: string;
  defaultCapacity: string;
  active: boolean;
  rules: Record<RuleKey, RuleInput>;
}

export type FieldName =
  'title' | 'description' | 'durationMinutes' | 'defaultCapacity' | `bookingRules.${RuleKey}`;

export type FieldErrors = Partial<Record<FieldName, string>>;

export const FIELD_MESSAGES: Record<FieldName, string> = {
  title: 'Bitte einen Titel mit höchstens 120 Zeichen eingeben.',
  description: 'Die Beschreibung darf höchstens 2000 Zeichen lang sein.',
  durationMinutes: 'Bitte eine Dauer von 5 bis 480 Minuten in 5-Minuten-Schritten eingeben.',
  defaultCapacity: 'Ein Gruppenkurs braucht mindestens 2 Plätze.',
  'bookingRules.minLeadMinutes': 'Bitte eine Anzahl Stunden ab 0 eingeben.',
  'bookingRules.horizonDays': 'Bitte 1 bis 730 Tage eingeben.',
  'bookingRules.changeDeadlineMinutes': 'Bitte eine Anzahl Stunden ab 0 eingeben.',
};

/** Reihenfolge der Felder für den Fokus auf den ersten Fehler. */
export const FIELD_ORDER: readonly FieldName[] = [
  'title',
  'description',
  'durationMinutes',
  'defaultCapacity',
  'bookingRules.minLeadMinutes',
  'bookingRules.horizonDays',
  'bookingRules.changeDeadlineMinutes',
];

const RULE_KEYS: readonly RuleKey[] = ['minLeadMinutes', 'horizonDays', 'changeDeadlineMinutes'];

/** Vorlauf und Frist werden in Stunden eingegeben, der Horizont in Tagen. */
export function ruleUnit(key: RuleKey): 'hours' | 'days' {
  return key === 'horizonDays' ? 'days' : 'hours';
}

const DEFAULT_RULE: RuleInput = { useDefault: true, value: '' };

export function emptyServiceForm(type: ServiceType): ServiceFormValues {
  return {
    type,
    title: '',
    description: '',
    durationMinutes: '60',
    defaultCapacity: type === 'group' ? '10' : '',
    active: true,
    rules: {
      minLeadMinutes: DEFAULT_RULE,
      horizonDays: DEFAULT_RULE,
      changeDeadlineMinutes: DEFAULT_RULE,
    },
  };
}

function ruleToInput(key: RuleKey, value: number | null): RuleInput {
  if (value === null) return DEFAULT_RULE;
  return {
    useDefault: false,
    value: String(ruleUnit(key) === 'hours' ? Number((value / 60).toFixed(2)) : value),
  };
}

export function serviceToForm(service: Service): ServiceFormValues {
  return {
    type: service.type,
    title: service.title,
    description: service.description ?? '',
    durationMinutes: String(service.durationMinutes),
    defaultCapacity: service.type === 'group' ? String(service.defaultCapacity) : '',
    active: service.active,
    rules: {
      minLeadMinutes: ruleToInput('minLeadMinutes', service.bookingRules.minLeadMinutes),
      horizonDays: ruleToInput('horizonDays', service.bookingRules.horizonDays),
      changeDeadlineMinutes: ruleToInput(
        'changeDeadlineMinutes',
        service.bookingRules.changeDeadlineMinutes,
      ),
    },
  };
}

/** Text → Zahl; leere oder ungültige Eingaben werden zu `undefined` bzw. `NaN` (Schema meldet sie). */
function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? undefined : Number(trimmed);
}

function ruleValue(key: RuleKey, input: RuleInput): number | null | undefined {
  if (input.useDefault) return null;
  const parsed = parseNumber(input.value);
  if (parsed === undefined || ruleUnit(key) === 'days') return parsed;
  // Stunden → Minuten; ganze Minuten, damit z. B. 1,5 Stunden 90 Minuten ergeben.
  return Math.round(parsed * 60);
}

export type ValidationResult =
  { ok: true; data: ServiceCreate } | { ok: false; errors: FieldErrors; firstError: FieldName };

export function validateServiceForm(values: ServiceFormValues): ValidationResult {
  const description = values.description.trim();
  const candidate = {
    type: values.type,
    title: values.title,
    description: description === '' ? null : description,
    active: values.active,
    durationMinutes: parseNumber(values.durationMinutes),
    ...(values.type === 'group' ? { defaultCapacity: parseNumber(values.defaultCapacity) } : {}),
    bookingRules: Object.fromEntries(
      RULE_KEYS.map((key) => [key, ruleValue(key, values.rules[key])]),
    ),
  };
  const parsed = serviceCreateSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, data: parsed.data };

  const errors = fieldErrorsFromPaths(parsed.error.issues.map((issue) => issue.path.join('.')));
  const firstError = FIELD_ORDER.find((field) => errors[field]) ?? 'title';
  return { ok: false, errors, firstError };
}

/** Feldpfade (aus dem Schema oder einer 400-Antwort der API) → Meldungen am Feld. */
export function fieldErrorsFromPaths(paths: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const path of paths) {
    const field = FIELD_ORDER.find((name) => name === path);
    if (field) errors[field] = FIELD_MESSAGES[field];
  }
  return errors;
}

/**
 * Teiländerung mit nur den geänderten Feldern (`type` immer, weil die API es verlangt).
 * `null`, wenn nichts geändert wurde.
 */
export function servicePatch(original: Service, data: ServiceCreate): ServiceUpdate | null {
  const changed: {
    title?: string;
    description?: string | null;
    active?: boolean;
    durationMinutes?: number;
    defaultCapacity?: number;
    bookingRules?: Partial<BookingRules>;
  } = {};
  if (data.title !== original.title) changed.title = data.title;
  if (data.description !== original.description) changed.description = data.description;
  if (data.active !== original.active) changed.active = data.active;
  if (data.durationMinutes !== original.durationMinutes) {
    changed.durationMinutes = data.durationMinutes;
  }
  if (
    data.type === 'group' &&
    original.type === 'group' &&
    data.defaultCapacity !== original.defaultCapacity
  ) {
    changed.defaultCapacity = data.defaultCapacity;
  }
  const rules: Partial<BookingRules> = {};
  for (const key of RULE_KEYS) {
    if (data.bookingRules[key] !== original.bookingRules[key]) rules[key] = data.bookingRules[key];
  }
  if (Object.keys(rules).length > 0) changed.bookingRules = rules;
  if (Object.keys(changed).length === 0) return null;
  // `defaultCapacity` kann nur bei Gruppenkursen gesetzt sein (siehe oben).
  return original.type === 'group' ? { ...changed, type: 'group' } : { ...changed, type: 'single' };
}
