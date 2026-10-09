// Kurzbeschreibung eines Termins: Angebot, Datum und Uhrzeit in der Zeitzone der Installation.
import type { PublicService } from '@fw-booking/shared';
import { formatDate, formatTimeRange } from '@fw-booking/shared/format';
import { el, withSeparators } from '../dom.js';

export interface AppointmentTime {
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/** Text wie „Herrenhaarschnitt · Mo., 12. Okt. 2026 · 14:30–15:00“. */
export function appointmentText(title: string, time: AppointmentTime): string {
  return [
    title,
    formatDate(time.startsAt, time.timeZone),
    formatTimeRange(time.startsAt, time.endsAt, time.timeZone),
  ].join(' · ');
}

export function selectionSummary(
  doc: Document,
  service: Pick<PublicService, 'title'>,
  time: AppointmentTime,
): HTMLElement {
  return el(
    doc,
    'p',
    { className: 'summary' },
    withSeparators(doc, [
      el(doc, 'span', { className: 'summary-service', text: service.title }),
      el(doc, 'span', {
        className: 'summary-date',
        text: formatDate(time.startsAt, time.timeZone),
      }),
      el(doc, 'span', {
        className: 'summary-time',
        text: formatTimeRange(time.startsAt, time.endsAt, time.timeZone),
      }),
    ]),
  );
}
