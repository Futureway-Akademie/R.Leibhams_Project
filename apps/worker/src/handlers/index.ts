// Registrierte Job-Handler, je Jobtyp der Outbox einer.
import type { JobHandlers } from '../worker.js';
import {
  bookingCancellationHandler,
  bookingRebookedHandler,
  ownerCancellationHandler,
} from './booking-changes.js';
import { bookingConfirmationHandler } from './booking-confirmation.js';
import { bookingReminderHandler } from './booking-reminder.js';
import type { MailHandlerDeps } from './common.js';

export type { MailHandlerDeps } from './common.js';

export function createHandlers(deps: MailHandlerDeps): JobHandlers {
  return {
    booking_confirmation: bookingConfirmationHandler(deps),
    booking_cancellation: bookingCancellationHandler(deps),
    booking_rebooked: bookingRebookedHandler(deps),
    owner_cancellation: ownerCancellationHandler(deps),
    booking_reminder: bookingReminderHandler(deps),
  };
}
