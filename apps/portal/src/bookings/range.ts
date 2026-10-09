// Zeitraum der Buchungsübersicht (lokale Daten der Installation, jeweils einschließlich).
import { MAX_BOOKING_LIST_DAYS } from '@fw-booking/shared';
import { addDays, isDate } from '../availability/time.js';

export interface DateRange {
  from: string;
  to: string;
}

export const DEFAULT_RANGE_DAYS = 31;

export interface RangePreset {
  key: string;
  label: string;
  range: (today: string) => DateRange;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: 'heute', label: 'Heute', range: (today) => ({ from: today, to: today }) },
  { key: '7', label: 'Nächste 7 Tage', range: (today) => ({ from: today, to: addDays(today, 6) }) },
  {
    key: '31',
    label: 'Nächste 31 Tage',
    range: (today) => ({ from: today, to: addDays(today, DEFAULT_RANGE_DAYS - 1) }),
  },
  {
    key: 'vergangen',
    label: 'Letzte 31 Tage',
    range: (today) => ({ from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), to: today }),
  },
];

/** Anzahl der Tage einschließlich beider Grenzen. */
export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
}

export type RangeError = 'from' | 'to' | 'order' | 'length';

export function checkRange(range: DateRange): RangeError | null {
  if (!isDate(range.from)) return 'from';
  if (!isDate(range.to)) return 'to';
  if (range.to < range.from) return 'order';
  if (rangeDays(range) > MAX_BOOKING_LIST_DAYS) return 'length';
  return null;
}

export const RANGE_ERROR_MESSAGES: Record<RangeError, string> = {
  from: 'Bitte ein gültiges Startdatum eingeben.',
  to: 'Bitte ein gültiges Enddatum eingeben.',
  order: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  length: `Höchstens ${String(MAX_BOOKING_LIST_DAYS)} Tage auf einmal.`,
};

/** Zeitraum aus der Adresse (`?von=&bis=`); ungültige Angaben ergeben den Standard. */
export function rangeFromParams(params: URLSearchParams, today: string): DateRange {
  const range = { from: params.get('von') ?? '', to: params.get('bis') ?? '' };
  return checkRange(range) === null
    ? range
    : { from: today, to: addDays(today, DEFAULT_RANGE_DAYS - 1) };
}
