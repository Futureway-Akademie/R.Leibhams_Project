// Fachliche Konstanten aus docs/domain-rules.md.

/** Wählbare Slot-Raster für Einzeltermine in Minuten. */
export const SLOT_GRID_MINUTES = [20, 30, 45, 60, 90] as const;
export const DEFAULT_SLOT_GRID_MINUTES = 30;

/** Kleinste Zeiteinheit der Ressourcenbelegung; Dauer und Puffer sind Vielfache davon. */
export const OCCUPANCY_UNIT_MINUTES = 5;

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;
export const MAX_BUFFER_MINUTES = 60;
export const DEFAULT_BUFFER_MINUTES = 0;

export const MIN_GROUP_CAPACITY = 2;

export const DEFAULT_MIN_LEAD_MINUTES = 24 * 60;
export const DEFAULT_BOOKING_HORIZON_DAYS = 90;
export const DEFAULT_CHANGE_DEADLINE_MINUTES = 24 * 60;
export const DEFAULT_REMINDER_LEAD_MINUTES = 24 * 60;

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';
