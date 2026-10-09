// Sichtbare Texte des Widgets (Deutsch, Anrede „du“ wie in den E-Mails).
import { ApiError } from './api/client.js';

export const messages = {
  loading: 'Buchungskalender wird geladen …',
  loadingSessions: 'Kurstermine werden geladen …',
  noServices: 'Derzeit sind keine Angebote buchbar.',
  noSessions: 'Derzeit sind keine Kurstermine buchbar.',
  noMoreSessions: 'Keine weiteren Kurstermine im Buchungszeitraum.',
  moreSessions: 'Weitere Termine',
  loadingMore: 'Lädt …',
  retry: 'Erneut versuchen',
  back: 'Alle Angebote',
  chooseService: 'Angebot auswählen',
  full: 'Ausgebucht',
  singleFollows: 'Die Terminauswahl für dieses Angebot folgt in Kürze.',
  serviceNotFound: 'Dieses Angebot ist derzeit nicht buchbar.',
  misconfigured: 'Der Buchungskalender ist nicht richtig eingebunden.',
  timeZoneHint: (timeZone: string) => `Alle Zeiten in der Zeitzone ${timeZone}.`,
  minutes: (minutes: number) => `${String(minutes)} Min.`,
  freeSeats: (count: number) => (count === 1 ? '1 Platz frei' : `${String(count)} Plätze frei`),
} as const;

/** Verständliche Meldung zu einem Ladefehler, ohne technische Details. */
export function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'timeout') {
      return 'Die Anfrage hat zu lange gedauert. Bitte versuche es erneut.';
    }
    if (error.kind === 'network') {
      return 'Der Buchungskalender ist gerade nicht erreichbar. Bitte versuche es später erneut.';
    }
    if (error.code === 'rate_limited') {
      return error.retryAfterSeconds === null
        ? 'Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.'
        : `Zu viele Anfragen. Bitte versuche es in ${String(error.retryAfterSeconds)} Sekunden erneut.`;
    }
    if (error.status === 404) return 'Dieser Buchungskalender wurde nicht gefunden.';
  }
  return 'Die Termine konnten nicht geladen werden. Bitte versuche es erneut.';
}
