import { isApiError } from './client.js';

/** Allgemeiner Text für fehlgeschlagene Änderungen; fachliche Fälle ergänzen die Bereiche selbst. */
export function requestErrorMessage(error: unknown): string {
  if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
    return 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen und erneut versuchen.';
  }
  if (isApiError(error, 400)) return 'Bitte die Eingaben prüfen.';
  // 409: Die API liefert eine deutsche Begründung.
  if (isApiError(error, 409)) return error.message;
  return 'Bitte später erneut versuchen.';
}
