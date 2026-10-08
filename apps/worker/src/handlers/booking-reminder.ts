// Erinnerung vor dem Termin (task-3-4). Der Planer legt den Auftrag an; vor dem Versand wird
// erneut geprüft, dass die Buchung noch bestätigt ist, der Termin noch nicht begonnen hat und
// sich nicht verschoben hat. Sonst wird der Auftrag ohne Mail abgeschlossen (`skipped`).
import { collections } from '@fw-booking/db';
import { reminderMail } from '../mail/reminder.js';
import type { JobHandler } from '../worker.js';
import { loadBooking, loadContext, newManageLink, sendBookingMail } from './common.js';
import type { MailHandlerDeps } from './common.js';

export function bookingReminderHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const booking = await loadBooking(db, job);
    if (booking.status !== 'confirmed') return 'skipped';
    if (booking.startsAt <= now) return 'skipped';
    if (job.scheduledFor && job.scheduledFor.getTime() !== booking.startsAt.getTime()) {
      return 'skipped';
    }
    if (booking.sessionId) {
      const session = await collections(db).sessions.findOne({ _id: booking.sessionId });
      if (session?.status === 'cancelled') return 'skipped';
    }

    const context = await loadContext(db, booking, deps, now);
    const link = await newManageLink(db, booking, deps, now);
    const content = reminderMail({
      ...context.base,
      changeDeadline: context.changeDeadline,
      manageUrl: link.url,
      // Höchstens eine Umbuchung je Buchung: Ergebnis einer Umbuchung nur noch stornierbar.
      rebookAllowed: context.predecessor === null,
    });
    return sendBookingMail(db, deps, job, booking, content, link.token);
  };
}
