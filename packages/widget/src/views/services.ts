// Angebotsliste: eine Schaltfläche je aktivem Angebot in der Reihenfolge der API.
import type { PublicService } from '@fw-booking/shared';
import { button, el, withSeparators } from '../dom.js';
import { messages } from '../messages.js';

export function servicesView(
  doc: Document,
  services: readonly PublicService[],
  open: (service: PublicService) => void,
): HTMLElement {
  return el(doc, 'div', { className: ['view', 'services'] }, [
    el(doc, 'h3', { className: 'services-title', text: messages.chooseService }),
    el(
      doc,
      'ul',
      { className: 'service-list' },
      services.map((service) =>
        el(doc, 'li', { className: 'service-item' }, [
          button(
            doc,
            { className: ['service', `service--${service.type}`] },
            () => {
              open(service);
            },
            withSeparators(doc, [
              el(doc, 'span', { className: 'service-name', text: service.title }),
              el(doc, 'span', {
                className: 'service-meta',
                text: messages.minutes(service.durationMinutes),
              }),
            ]),
          ),
        ]),
      ),
    ),
  ]);
}
