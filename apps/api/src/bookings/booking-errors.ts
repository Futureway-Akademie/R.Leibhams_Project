import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { BookingErrorCode } from '@fw-booking/shared';

const MESSAGES: Record<BookingErrorCode, string> = {
  session_full: 'Der Termin ist inzwischen ausgebucht',
  slot_taken: 'Der Termin ist inzwischen vergeben',
  not_bookable: 'Der Termin ist nicht mehr buchbar',
  already_booked: 'Für diese E-Mail-Adresse besteht bereits eine Buchung für diesen Termin',
  idempotency_conflict: 'Die Anfrage passt nicht zu einer früheren Anfrage mit demselben Schlüssel',
  change_deadline_passed:
    'Die Frist für Änderungen über den Link ist abgelaufen; bitte wende dich direkt an uns',
  not_cancellable: 'Diese Buchung kann nicht mehr storniert werden',
  link_expired: 'Der Link ist abgelaufen',
  rebook_not_allowed:
    'Diese Buchung kann nicht mehr umgebucht werden; eine Stornierung ist weiterhin möglich',
  rate_limited: 'Zu viele Anfragen; bitte versuche es später erneut',
  too_many_bookings:
    'Mit dieser E-Mail-Adresse wurden gerade sehr viele Termine gebucht; bitte versuche es später erneut',
  origin_not_allowed: 'Diese Website ist für die Buchung nicht freigegeben',
};

/** 409 mit fachlichem Code, damit das Widget eine passende Meldung zeigen kann. */
export function bookingConflict(code: BookingErrorCode): ConflictException {
  return new ConflictException({ statusCode: 409, message: MESSAGES[code], code });
}

/** 429 mit fachlichem Code, z. B. beim Buchungslimit je E-Mail-Adresse. */
export function bookingLimit(code: 'rate_limited' | 'too_many_bookings'): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: MESSAGES[code], code },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
