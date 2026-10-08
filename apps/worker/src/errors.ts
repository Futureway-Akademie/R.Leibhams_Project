/**
 * Fehler eines Job-Handlers mit Kategorie. Gespeichert wird nur die Kategorie (z. B.
 * `smtp_unavailable`), nie die Meldung, weil Treiber- und SMTP-Fehler Adressen oder
 * Zugangsdaten enthalten können.
 */
export class JobError extends Error {
  override name = 'JobError';

  constructor(
    readonly category: string,
    /** Vorübergehend (Wiederholung mit Backoff) oder dauerhaft (sofort `failed`). */
    readonly retryable: boolean,
  ) {
    super(category);
  }
}

/** Vorübergehender Fehler, z. B. Mailserver nicht erreichbar. */
export const temporaryFailure = (category: string) => new JobError(category, true);

/** Dauerhafter Fehler, z. B. Buchung existiert nicht mehr oder Empfänger abgelehnt. */
export const permanentFailure = (category: string) => new JobError(category, false);

/** Kategorie und Wiederholbarkeit eines beliebigen Fehlers. Unbekannte Fehler gelten als vorübergehend. */
export function classify(error: unknown): { category: string; retryable: boolean } {
  if (error instanceof JobError) return { category: error.category, retryable: error.retryable };
  return { category: 'unexpected', retryable: true };
}
