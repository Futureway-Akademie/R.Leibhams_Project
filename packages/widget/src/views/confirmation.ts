// Bestätigung nach erfolgreicher Buchung. Der Verwaltungslink kommt nur per E-Mail.
import type { BookingConfirmation } from '@fw-booking/shared';
import { button, el } from '../dom.js';
import { messages } from '../messages.js';
import { selectionSummary } from './summary.js';

export function confirmationView(
  doc: Document,
  confirmation: BookingConfirmation,
  email: string,
  bookAnother: () => void,
): HTMLElement {
  const title = el(doc, 'h3', {
    className: 'confirmation-title',
    text: messages.bookedTitle,
    attrs: { tabindex: '-1' },
  });
  const node = el(doc, 'div', { className: ['view', 'confirmation'], attrs: { role: 'status' } }, [
    title,
    selectionSummary(doc, { title: confirmation.serviceTitle }, confirmation),
    el(doc, 'p', { className: 'confirmation-mail', text: messages.bookedMail(email) }),
    button(doc, { className: 'book-another', text: messages.bookAnother }, bookAnother),
  ]);
  queueMicrotask(() => {
    if (node.isConnected) title.focus();
  });
  return node;
}
