// Fachliche Konstanten aus docs/domain-rules.md.

/**
 * Kleinste Zeiteinheit der Ressourcenbelegung. Dauern sind Vielfache davon, und Einzeltermine
 * werden in diesem Raster angeboten.
 */
export const OCCUPANCY_UNIT_MINUTES = 5;

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;

export const MIN_GROUP_CAPACITY = 2;

export const DEFAULT_MIN_LEAD_MINUTES = 24 * 60;
export const DEFAULT_BOOKING_HORIZON_DAYS = 90;
export const DEFAULT_CHANGE_DEADLINE_MINUTES = 24 * 60;
export const DEFAULT_REMINDER_LEAD_MINUTES = 24 * 60;

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';
