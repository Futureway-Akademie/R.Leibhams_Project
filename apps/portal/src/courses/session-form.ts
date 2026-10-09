// Formulare für einzelne Kurstermine. Datum und Uhrzeit gelten in der Zeitzone der Installation
// und werden für die API in UTC umgerechnet.
import { MIN_GROUP_CAPACITY, localToUtc } from '@fw-booking/shared';
import type { Session, SessionCreate, SessionUpdate } from '@fw-booking/shared';
import { isDate, isOnGrid, isTime } from '../availability/time.js';
import { sessionLocalStart } from './format.js';

export interface SessionInput {
  serviceId: string;
  date: string;
  time: string;
  /** Leer: Standardkapazität des Angebots (nur beim Anlegen). */
  capacity: string;
  location: string;
}

export type SessionField = 'serviceId' | 'date' | 'time' | 'capacity' | 'location';
export type SessionErrors = Partial<Record<SessionField, string>>;

const FIELD_ORDER: readonly SessionField[] = ['serviceId', 'date', 'time', 'capacity', 'location'];

export function sessionToInput(session: Session): SessionInput {
  const local = sessionLocalStart(session);
  return {
    serviceId: session.serviceId,
    date: local.date,
    time: local.time,
    capacity: String(session.capacity),
    location: session.location ?? '',
  };
}

interface Parsed {
  startsAt: string;
  capacity: number | null;
  location: string | null;
}

function parse(
  input: SessionInput,
  timeZone: string,
  options: { requireService: boolean; minCapacity: number; capacityRequired: boolean },
): { ok: true; value: Parsed } | { ok: false; errors: SessionErrors; firstError: SessionField } {
  const errors: SessionErrors = {};
  if (options.requireService && input.serviceId === '') {
    errors.serviceId = 'Bitte einen Gruppenkurs wählen.';
  }
  if (!isDate(input.date)) errors.date = 'Bitte ein Datum eingeben.';
  if (!isTime(input.time)) errors.time = 'Bitte eine Uhrzeit eingeben.';
  else if (!isOnGrid(input.time)) errors.time = 'Nur 5-Minuten-Schritte (z. B. 18:05).';

  let capacity: number | null = null;
  const capacityText = input.capacity.trim();
  if (capacityText !== '' || options.capacityRequired) {
    capacity = Number(capacityText);
    if (capacityText === '' || !Number.isInteger(capacity) || capacity < options.minCapacity) {
      errors.capacity =
        options.minCapacity > MIN_GROUP_CAPACITY
          ? `Mindestens ${String(options.minCapacity)} Plätze (bereits gebucht).`
          : `Mindestens ${String(MIN_GROUP_CAPACITY)} Plätze.`;
    }
  }
  const location = input.location.trim();
  if (location.length > 200) errors.location = 'Höchstens 200 Zeichen.';

  let startsAt = '';
  if (!errors.date && !errors.time) {
    const utc = localToUtc(`${input.date}T${input.time}`, timeZone);
    if (utc.ok) startsAt = utc.utc;
    else errors.time = 'Diese Uhrzeit gibt es an diesem Tag wegen der Zeitumstellung nicht.';
  }

  const firstError = FIELD_ORDER.find((field) => errors[field]);
  if (firstError) return { ok: false, errors, firstError };
  return { ok: true, value: { startsAt, capacity, location: location === '' ? null : location } };
}

export type SessionCreateValidation =
  | { ok: true; data: SessionCreate }
  | { ok: false; errors: SessionErrors; firstError: SessionField };

export function validateNewSession(input: SessionInput, timeZone: string): SessionCreateValidation {
  const result = parse(input, timeZone, {
    requireService: true,
    minCapacity: MIN_GROUP_CAPACITY,
    capacityRequired: false,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: { serviceId: input.serviceId, ...result.value },
  };
}

export type SessionUpdateValidation =
  | { ok: true; patch: SessionUpdate | null }
  | { ok: false; errors: SessionErrors; firstError: SessionField };

/** Teiländerung nur mit geänderten Feldern; `null` ohne Änderung. */
export function validateSessionChange(
  original: Session,
  input: SessionInput,
): SessionUpdateValidation {
  const result = parse(input, original.timeZone, {
    requireService: false,
    minCapacity: Math.max(MIN_GROUP_CAPACITY, original.bookedCount),
    capacityRequired: true,
  });
  if (!result.ok) return result;
  const { startsAt, capacity, location } = result.value;
  const patch: SessionUpdate = {};
  if (Date.parse(startsAt) !== Date.parse(original.startsAt)) patch.startsAt = startsAt;
  if (capacity !== null && capacity !== original.capacity) patch.capacity = capacity;
  if (location !== original.location) patch.location = location;
  return { ok: true, patch: Object.keys(patch).length > 0 ? patch : null };
}
