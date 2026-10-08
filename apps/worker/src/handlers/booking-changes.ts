// Mails zu Storno, Umbuchung und Owner-Absage (task-3-3). Storno und Absage melden einen
// Endzustand und werden immer versendet, solange die Buchung diesen Status trägt. Eine überholte
// Umbuchungsmail (neue Buchung bereits storniert oder abgesagt) wird übersprungen.
import { cancellationMail, ownerCancellationMail, rebookedMail } from '../mail/changes.js';
import type { JobHandler } from '../worker.js';
import { loadBooking, loadContext, locationOf, newManageLink, sendBookingMail } from './common.js';
import type { MailHandlerDeps } from './common.js';

export function bookingCancellationHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const booking = await loadBooking(db, job);
    if (booking.status !== 'cancelled') return 'skipped';
    const context = await loadContext(db, booking, deps, now);
    const content = cancellationMail({
      ...context.base,
      bookingPageUrl: deps.mail.bookingPageUrl,
      sequence: context.predecessor ? 1 : 0,
    });
    return sendBookingMail(db, deps, job, booking, content);
  };
}

export function ownerCancellationHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const booking = await loadBooking(db, job);
    if (booking.status !== 'cancelled_by_owner') return 'skipped';
    const context = await loadContext(db, booking, deps, now);
    const content = ownerCancellationMail({
      ...context.base,
      bookingPageUrl: deps.mail.bookingPageUrl,
      sequence: context.predecessor ? 1 : 0,
      reason: booking.ownerCancellationReason ?? null,
    });
    return sendBookingMail(db, deps, job, booking, content);
  };
}

/** Der Auftrag verweist auf die neue Buchung; die bisherige zeigt per `rebookedToBookingId` auf sie. */
export function bookingRebookedHandler(deps: MailHandlerDeps): JobHandler {
  return async (job, { db }) => {
    const now = deps.now?.() ?? new Date();
    const booking = await loadBooking(db, job);
    if (booking.status !== 'confirmed') return 'skipped';
    const context = await loadContext(db, booking, deps, now);
    const previous = context.predecessor;
    const link = await newManageLink(db, booking, deps, now);
    const content = rebookedMail({
      ...context.base,
      changeDeadline: context.changeDeadline,
      manageUrl: link.url,
      previous: previous
        ? {
            serviceTitle: context.service.title,
            startsAt: previous.startsAt,
            endsAt: previous.endsAt,
            timeZone: previous.timeZone,
            location: await locationOf(db, previous),
          }
        : null,
    });
    return sendBookingMail(db, deps, job, booking, content, link.token);
  };
}
