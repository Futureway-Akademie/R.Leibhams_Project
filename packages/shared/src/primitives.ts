import { z } from 'zod';
import { OCCUPANCY_UNIT_MINUTES } from './constants.js';

/** MongoDB-ObjectId als 24-stelliger Hex-String. */
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Ungültige ID');

/** Konkreter Zeitpunkt in UTC, z. B. `2026-10-07T08:00:00Z`. Offsets sind nicht erlaubt. */
export const utcDateTimeSchema = z.iso.datetime({ offset: false });

/** Lokales Datum ohne Zeitzone, z. B. `2026-10-07`. */
export const localDateSchema = z.iso.date();

/** Lokale Uhrzeit `HH:MM` ohne Zeitzone. `24:00` ist nur als Ende eines Zeitfensters sinnvoll. */
export const localTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Erwartet HH:MM');

/** Ob eine Uhrzeit `HH:MM` (auch am Ende eines `YYYY-MM-DDTHH:MM`) auf dem 5-Minuten-Raster liegt. */
export function isOnUnitGrid(time: string): boolean {
  return Number(time.slice(-2)) % OCCUPANCY_UNIT_MINUTES === 0;
}

/** Lokale Uhrzeit auf dem 5-Minuten-Raster der Belegungseinheiten. */
export const unitLocalTimeSchema = localTimeSchema.refine(
  isOnUnitGrid,
  'Nur 5-Minuten-Schritte erlaubt',
);

/** Lokaler Zeitpunkt `YYYY-MM-DDTHH:MM` ohne Zeitzone. Lexikografisch sortierbar. */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/, 'Erwartet YYYY-MM-DDTHH:MM');

/** Lokaler Zeitpunkt auf dem 5-Minuten-Raster. */
export const unitLocalDateTimeSchema = localDateTimeSchema.refine(
  isOnUnitGrid,
  'Nur 5-Minuten-Schritte erlaubt',
);

/** IANA-Zeitzone, z. B. `Europe/Berlin`. */
export const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unbekannte Zeitzone');

/** Ganzzahlige Minuten als Vielfaches der Belegungseinheit. */
export const unitMinutesSchema = z
  .int()
  .nonnegative()
  .multipleOf(
    OCCUPANCY_UNIT_MINUTES,
    `Muss ein Vielfaches von ${String(OCCUPANCY_UNIT_MINUTES)} sein`,
  );

/** Vom Client erzeugter Schlüssel, der wiederholte Buchungsanfragen erkennbar macht. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,100}$/, 'Ungültiger Idempotenzschlüssel');

/** Minuten seit Mitternacht für `HH:MM`. */
export function localTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
