import { ConflictException } from '@nestjs/common';
import type { BookingErrorCode } from '@fw-booking/shared';

const MESSAGES: Record<BookingErrorCode, string> = {
  session_full: 'Der Termin ist inzwischen ausgebucht',
  slot_taken: 'Der Termin ist inzwischen vergeben',
  not_bookable: 'Der Termin ist nicht mehr buchbar',
  already_booked: 'Für diese E-Mail-Adresse besteht bereits eine Buchung für diesen Termin',
  idempotency_conflict: 'Die Anfrage passt nicht zu einer früheren Anfrage mit demselben Schlüssel',
};

/** 409 mit fachlichem Code, damit das Widget eine passende Meldung zeigen kann. */
export function bookingConflict(code: BookingErrorCode): ConflictException {
  return new ConflictException({ statusCode: 409, message: MESSAGES[code], code });
}
