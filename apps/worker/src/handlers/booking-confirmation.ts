// Bestätigungsmail nach einer Buchung (task-3-2): stellt einen neuen Verwaltungslink aus und
// versendet die Mail. Nicht mehr aktive Buchungen werden übersprungen; über Storno, Umbuchung
// oder Absage informieren eigene Mails.
import { confirmationMail } from '../mail/confirmation.js';
import type { JobHandler } from '../worker.js';
import { loadBooking, loadContext, newManageLink, sendBookingMail } from './common.js';
import type { MailHandlerDeps } from './common.js';

export function bookingConfirmationHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const booking = await loadBooking(db, job);
    if (booking.status !== 'confirmed') return 'skipped';
    const context = await loadContext(db, booking, deps, now);
    const link = await newManageLink(db, booking, deps, now);
    const content = confirmationMail({
      ...context.base,
      changeDeadline: context.changeDeadline,
      manageUrl: link.url,
    });
    return sendBookingMail(db, deps, job, booking, content, link.token);
  };
}
