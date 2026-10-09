import { isApiError } from '../api/client.js';
import { requestErrorMessage } from '../api/messages.js';

/** Verständlicher Text für fehlgeschlagene Änderungen an Angeboten. */
export function mutationErrorMessage(error: unknown): string {
  if (isApiError(error, 404)) return 'Das Angebot wurde nicht gefunden.';
  return requestErrorMessage(error);
}
