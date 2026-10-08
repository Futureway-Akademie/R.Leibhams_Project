// Registrierte Job-Handler. Storno-, Umbuchungs- und Absagemails folgen in task-3-3,
// Erinnerungen in task-3-4; bis dahin bleiben diese Aufträge unbearbeitet in der Outbox.
import type { JobHandlers } from '../worker.js';
import { bookingConfirmationHandler } from './booking-confirmation.js';
import type { MailHandlerDeps } from './booking-confirmation.js';

export function createHandlers(deps: MailHandlerDeps): JobHandlers {
  return {
    booking_confirmation: bookingConfirmationHandler(deps),
  };
}
