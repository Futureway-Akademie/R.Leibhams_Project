import { isApiError } from '../api/client.js';

/** Verständlicher Text für fehlgeschlagene Änderungen an Angeboten. */
export function mutationErrorMessage(error: unknown): string {
  if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
    return 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen und erneut versuchen.';
  }
  if (isApiError(error, 404)) return 'Das Angebot wurde nicht gefunden.';
  if (isApiError(error, 400)) return 'Bitte die Eingaben prüfen.';
  // 409: Die API liefert eine deutsche Begründung (z. B. Terminart nicht änderbar).
  if (isApiError(error, 409)) return error.message;
  return 'Bitte später erneut versuchen.';
}
