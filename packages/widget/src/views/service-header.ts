// Kopf einer Angebotsansicht: Zurück zur Liste, Titel, Dauer und Beschreibung.
import type { PublicService } from '@fw-booking/shared';
import { button, el } from '../dom.js';
import { messages } from '../messages.js';

export function serviceHeader(
  doc: Document,
  service: PublicService,
  back: (() => void) | null,
): HTMLElement {
  return el(doc, 'div', { className: 'service-header' }, [
    back && button(doc, { className: 'back', text: messages.back }, back),
    el(doc, 'h3', { className: 'service-title', text: service.title }),
    el(doc, 'p', {
      className: 'service-duration',
      text: messages.minutes(service.durationMinutes),
    }),
    service.description !== null &&
      service.description !== '' &&
      el(doc, 'p', { className: 'service-description', text: service.description }),
  ]);
}
