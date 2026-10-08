// Registrierte Job-Handler. Erinnerungen folgen in task-3-4; bis dahin bleiben diese Aufträge
// unbearbeitet in der Outbox.
import type { JobHandlers } from '../worker.js';
import {
  bookingCancellationHandler,
  bookingRebookedHandler,
  ownerCancellationHandler,
} from './booking-changes.js';
import { bookingConfirmationHandler } from './booking-confirmation.js';
import type { MailHandlerDeps } from './common.js';

export type { MailHandlerDeps } from './common.js';

export function createHandlers(deps: MailHandlerDeps): JobHandlers {
  return {
    booking_confirmation: bookingConfirmationHandler(deps),
    booking_cancellation: bookingCancellationHandler(deps),
    booking_rebooked: bookingRebookedHandler(deps),
    owner_cancellation: ownerCancellationHandler(deps),
  };
}
