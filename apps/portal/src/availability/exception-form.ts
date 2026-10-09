// Formularzustand für Ausnahmen: ganztägig (Datum von–bis, Ende 00:00 am Folgetag) oder mit
// Uhrzeiten. Gespeichert wird lokal (`YYYY-MM-DDTHH:MM`, Ende ausschließlich).
import { availabilityExceptionCreateSchema } from '@fw-booking/shared';
import type { AvailabilityExceptionCreate } from '@fw-booking/shared';
import { addDays, isDate, isOnGrid, isTime } from './time.js';

export type ExceptionKind = AvailabilityExceptionCreate['kind'];

export interface ExceptionInput {
  kind: ExceptionKind;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  note: string;
}

export type ExceptionField = 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'note';
export type ExceptionErrors = Partial<Record<ExceptionField, string>>;

export const EXCEPTION_FIELD_ORDER: readonly ExceptionField[] = [
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'note',
];

export function emptyException(today: string): ExceptionInput {
  return {
    kind: 'closed',
    allDay: true,
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '12:00',
    note: '',
  };
}

export type ExceptionValidation =
  | { ok: true; data: AvailabilityExceptionCreate }
  | { ok: false; errors: ExceptionErrors; firstError: ExceptionField };

export function validateException(input: ExceptionInput): ExceptionValidation {
  const errors: ExceptionErrors = {};
  if (!isDate(input.startDate)) errors.startDate = 'Bitte ein Datum eingeben.';
  if (!isDate(input.endDate)) errors.endDate = 'Bitte ein Datum eingeben.';
  if (!input.allDay) {
    if (!isTime(input.startTime)) errors.startTime = 'Bitte eine Uhrzeit eingeben.';
    else if (!isOnGrid(input.startTime)) errors.startTime = 'Nur 5-Minuten-Schritte (z. B. 09:05).';
    if (!isTime(input.endTime)) errors.endTime = 'Bitte eine Uhrzeit eingeben.';
    else if (!isOnGrid(input.endTime)) errors.endTime = 'Nur 5-Minuten-Schritte (z. B. 17:55).';
  }
  const note = input.note.trim();
  if (note.length > 200) errors.note = 'Die Notiz darf höchstens 200 Zeichen lang sein.';

  const start = input.allDay ? `${input.startDate}T00:00` : `${input.startDate}T${input.startTime}`;
  const end = input.allDay
    ? `${addDaysSafe(input.endDate)}T00:00`
    : `${input.endDate}T${input.endTime}`;
  if (
    !errors.startDate &&
    !errors.endDate &&
    !errors.startTime &&
    !errors.endTime &&
    start >= end
  ) {
    if (input.allDay) errors.endDate = 'Das Ende darf nicht vor dem Beginn liegen.';
    else errors.endTime = 'Das Ende muss nach dem Beginn liegen.';
  }

  const firstError = EXCEPTION_FIELD_ORDER.find((field) => errors[field]);
  if (firstError) return { ok: false, errors, firstError };

  const parsed = availabilityExceptionCreateSchema.safeParse({
    kind: input.kind,
    start,
    end,
    note: note === '' ? null : note,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: { startDate: 'Der Zeitraum ist ungültig.' },
      firstError: 'startDate',
    };
  }
  return { ok: true, data: parsed.data };
}

function addDaysSafe(date: string): string {
  return isDate(date) ? addDays(date, 1) : date;
}
