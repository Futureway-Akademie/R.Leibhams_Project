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
  loadingDays: 'Freie Tage werden geladen …',
  loadingSlots: 'Freie Uhrzeiten werden geladen …',
  noFreeDays: 'Derzeit sind keine Termine frei.',
  noFreeDaysInMonth: 'In diesem Monat sind keine Termine frei.',
  noSlotsOnDay:
    'An diesem Tag sind inzwischen keine Uhrzeiten mehr frei. Bitte wähle einen anderen Tag.',
  previousMonth: 'Vorheriger Monat',
  nextMonth: 'Nächster Monat',
  morning: 'Vormittag',
  afternoon: 'Nachmittag',
  evening: 'Abend',
  continue: 'Weiter zu deinen Angaben',
  chosen: 'Gewählt:',
  formTitle: 'Deine Angaben',
  changeAppointment: 'Termin ändern',
  fieldName: 'Name',
  fieldEmail: 'E-Mail',
  fieldPhone: 'Telefon',
  phoneHint: 'Nur für kurzfristige Rückfragen zum Termin.',
  privacyBefore: 'Ich habe die ',
  privacyLink: 'Datenschutzhinweise',
  privacyAfter: ' gelesen.',
  submit: 'Verbindlich buchen',
  submitting: 'Wird gebucht …',
  invalidName: 'Bitte gib deinen Namen an (mindestens 2 Zeichen).',
  invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse an.',
  invalidPhone:
    'Bitte gib eine Telefonnummer an (6–20 Zeichen: Ziffern, Leerzeichen und + - / ( )).',
  invalidPrivacy: 'Bitte bestätige, dass du die Datenschutzhinweise gelesen hast.',
  checkInput: 'Bitte prüfe deine Angaben.',
  bookedTitle: 'Dein Termin ist gebucht',
  bookedMail: (email: string) =>
    `Du erhältst gleich eine Bestätigung per E-Mail an ${email}. Darin findest du auch den Link, mit dem du den Termin verwalten kannst.`,
  bookAnother: 'Weiteren Termin buchen',
  serviceNotFound: 'Dieses Angebot ist derzeit nicht buchbar.',
  manageTitle: 'Deine Buchung',
  manageLoading: 'Deine Buchung wird geladen …',
  bookedFor: 'Gebucht für',
  location: 'Ort',
  status: 'Status',
  statusConfirmed: 'Bestätigt',
  statusCancelled: 'Storniert',
  statusRebooked: 'Umgebucht',
  statusCancelledByOwner: 'Vom Anbieter abgesagt',
  changeUntil: (deadline: string) => `Änderungen über diesen Link sind bis ${deadline} möglich.`,
  changeClosed:
    'Änderungen über diesen Link sind nicht mehr möglich. Bitte wende dich bei Fragen direkt an uns.',
  rebookUsed:
    'Dieser Termin wurde bereits einmal umgebucht; eine Stornierung ist weiterhin möglich.',
  reloadHint:
    'Aus Sicherheitsgründen ist diese Ansicht nur bis zum Neuladen der Seite verfügbar. Öffne danach den Link aus deiner E-Mail erneut.',
  rebookAction: 'Termin umbuchen',
  cancelAction: 'Termin stornieren',
  backToBooking: 'Zurück zu deiner Buchung',
  chooseNewAppointment: 'Neuen Termin wählen',
  cancelQuestion: 'Möchtest du diesen Termin wirklich stornieren?',
  cancelConfirm: 'Ja, stornieren',
  rebookQuestion: 'Möchtest du deinen Termin wirklich umbuchen?',
  rebookConfirm: 'Ja, umbuchen',
  abort: 'Abbrechen',
  previousAppointment: 'Bisher:',
  newAppointment: 'Neu:',
  processing: 'Wird ausgeführt …',
  cancelledTitle: 'Dein Termin ist storniert',
  rebookedTitle: 'Dein Termin ist umgebucht',
  changeMail: 'Du erhältst gleich eine Bestätigung per E-Mail.',
  bookNew: 'Neuen Termin buchen',
  linkInvalid:
    'Dieser Verwaltungslink ist ungültig oder nicht mehr aktuell. Bitte nutze den Link aus deiner neuesten E-Mail.',
  linkExpired: 'Dieser Verwaltungslink ist abgelaufen, weil der Termin vorbei ist.',
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

/** Ergebnis eines fehlgeschlagenen Buchungsversuchs für das Formular. */
export interface BookingFailure {
  message: string;
  /** Termin ist vergeben oder nicht mehr buchbar: zurück zur Auswahl mit frischen Daten. */
  conflict: boolean;
}

export function bookingErrorMessage(error: unknown): BookingFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'slot_taken':
        return {
          conflict: true,
          message: 'Diese Uhrzeit wurde gerade vergeben. Bitte wähle eine andere.',
        };
      case 'session_full':
        return {
          conflict: true,
          message: 'Dieser Kurstermin ist inzwischen ausgebucht. Bitte wähle einen anderen.',
        };
      case 'not_bookable':
        return {
          conflict: true,
          message: 'Dieser Termin ist nicht mehr buchbar. Bitte wähle einen anderen.',
        };
      case 'already_booked':
        return {
          conflict: false,
          message: 'Mit dieser E-Mail-Adresse ist dieser Kurstermin bereits gebucht.',
        };
      case 'too_many_bookings':
        return {
          conflict: false,
          message:
            'Mit dieser E-Mail-Adresse wurden in kurzer Zeit zu viele Termine gebucht. Bitte versuche es später erneut.',
        };
      case 'idempotency_conflict':
        return {
          conflict: false,
          message: 'Die Buchung konnte nicht eindeutig zugeordnet werden. Bitte sende sie erneut.',
        };
      case 'rate_limited':
        return { conflict: false, message: loadErrorMessage(error) };
      default:
        break;
    }
    if (error.kind === 'network' || error.kind === 'timeout') {
      return {
        conflict: false,
        message:
          'Die Buchung konnte nicht gesendet werden. Bitte prüfe deine Verbindung und versuche es erneut.',
      };
    }
    if (error.status === 400) return { conflict: false, message: messages.checkInput };
    if (error.status === 404) {
      return {
        conflict: true,
        message: 'Dieser Termin ist nicht mehr buchbar. Bitte wähle einen anderen.',
      };
    }
  }
  return {
    conflict: false,
    message: 'Die Buchung ist fehlgeschlagen. Bitte versuche es erneut.',
  };
}

/** Meldung zu einem fehlgeschlagenen Storno oder einer Umbuchung über den Verwaltungslink. */
export function manageErrorMessage(error: unknown): BookingFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'change_deadline_passed':
        return { conflict: false, message: messages.changeClosed };
      case 'not_cancellable':
        return { conflict: false, message: 'Diese Buchung kann nicht mehr storniert werden.' };
      case 'rebook_not_allowed':
        return { conflict: false, message: messages.rebookUsed };
      case 'link_expired':
        return { conflict: false, message: messages.linkExpired };
      default:
        break;
    }
    if (error.status === 404 && error.code === null) {
      return { conflict: false, message: messages.linkInvalid };
    }
  }
  return bookingErrorMessage(error);
}

/** Meldung, wenn die Buchung über den Link nicht geladen werden kann. */
export function manageLoadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'link_expired') return messages.linkExpired;
    if (error.status === 404) return messages.linkInvalid;
  }
  return loadErrorMessage(error);
}
