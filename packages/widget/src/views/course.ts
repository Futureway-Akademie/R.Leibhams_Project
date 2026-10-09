// Kursansicht: Kurstermine eines Gruppenkurses nach Tagen, mit freien Plätzen, Nachladen weiterer
// Zeiträume sowie Lade-, Leer- und Fehlerzustand. Ausgebuchte Termine bleiben sichtbar.
import type { PublicService, PublicSession } from '@fw-booking/shared';
import { differsFromDeviceTimeZone, formatDate, formatTimeRange } from '@fw-booking/shared/format';
import type { ApiClient } from '../api/client.js';
import { button, el, withSeparators } from '../dom.js';
import { loadErrorMessage, messages } from '../messages.js';
import { addDays, localDate } from '../time.js';
import { errorMessage, infoMessage, statusMessage } from './common.js';
import { serviceHeader } from './service-header.js';

/**
 * Tage je Abfrage; entspricht MAX_AVAILABLE_DATES_RANGE_DAYS aus @fw-booking/shared (dort im
 * Zod-Modul, daher nicht importiert; ein Test prüft die Übereinstimmung).
 */
export const SESSION_WINDOW_DAYS = 62;

export interface CourseViewOptions {
  doc: Document;
  api: ApiClient;
  /** Wird abgebrochen, sobald die Ansicht verlassen oder das Widget entfernt wird. */
  signal: AbortSignal;
  service: PublicService;
  timeZone: string;
  now: () => Date;
  /** Zurück zur Angebotsliste; fehlt bei festem Angebot. */
  back: (() => void) | null;
  selectedSessionId: string | null;
  onSelect: (session: PublicSession) => void;
}

export function courseView(options: CourseViewOptions): HTMLElement {
  const { doc, api, signal, service, timeZone } = options;

  const list = el(doc, 'div', { className: 'sessions' });
  const status = el(doc, 'div', { className: 'sessions-status', attrs: { 'aria-live': 'polite' } });
  const more = button(doc, { className: 'more', text: messages.moreSessions }, () => {
    void load();
  });
  more.hidden = true;

  const view = el(doc, 'div', { className: ['view', 'course'] }, [
    serviceHeader(doc, service, options.back),
    differsFromDeviceTimeZone(timeZone) &&
      el(doc, 'p', { className: 'hint', text: messages.timeZoneHint(timeZone) }),
    list,
    status,
    more,
  ]);

  const days = new Map<string, HTMLUListElement>();
  const sessionButtons = new Map<string, HTMLButtonElement>();
  let selectedId = options.selectedSessionId;
  let from = localDate(options.now(), timeZone);
  let loaded = 0;

  function select(session: PublicSession) {
    selectedId = session.id;
    for (const [id, node] of sessionButtons) {
      node.setAttribute('aria-pressed', String(id === selectedId));
      node.classList.toggle('fw-booking-session--selected', id === selectedId);
    }
    options.onSelect(session);
  }

  function dayList(session: PublicSession): HTMLUListElement {
    const key = localDate(session.startsAt, timeZone);
    let ul = days.get(key);
    if (!ul) {
      ul = el(doc, 'ul', { className: 'session-list' });
      list.append(
        el(doc, 'section', { className: 'day' }, [
          el(doc, 'h4', { className: 'day-title', text: formatDate(session.startsAt, timeZone) }),
          ul,
        ]),
      );
      days.set(key, ul);
    }
    return ul;
  }

  function sessionItem(session: PublicSession): HTMLLIElement {
    const full = session.freeSeats === 0;
    const time = formatTimeRange(session.startsAt, session.endsAt, timeZone);
    const seats = full ? messages.full : messages.freeSeats(session.freeSeats);
    const label = [formatDate(session.startsAt, timeZone), time, session.location, seats]
      .filter((part) => part !== null && part !== '')
      .join(', ');
    const node = button(
      doc,
      {
        className: full ? ['session', 'session--full'] : 'session',
        attrs: { 'aria-label': label, 'aria-pressed': String(session.id === selectedId) },
      },
      () => {
        select(session);
      },
      withSeparators(doc, [
        el(doc, 'span', { className: 'session-time', text: time }),
        session.location !== null &&
          session.location !== '' &&
          el(doc, 'span', { className: 'session-location', text: session.location }),
        el(doc, 'span', { className: 'session-seats', text: seats }),
      ]),
    );
    if (full) {
      node.disabled = true;
    } else {
      sessionButtons.set(session.id, node);
      if (session.id === selectedId) node.classList.add('fw-booking-session--selected');
    }
    return el(doc, 'li', { className: 'session-item' }, [node]);
  }

  async function load(): Promise<void> {
    const to = addDays(from, SESSION_WINDOW_DAYS - 1);
    more.disabled = true;
    if (loaded === 0) {
      status.replaceChildren(statusMessage(doc, messages.loadingSessions));
    } else {
      more.textContent = messages.loadingMore;
      status.replaceChildren();
    }
    let sessions: PublicSession[];
    try {
      sessions = (await api.getSessions(service.id, from, to, signal)).sessions;
    } catch (error) {
      if (signal.aborted) return;
      more.disabled = false;
      more.textContent = messages.moreSessions;
      status.replaceChildren(
        errorMessage(doc, loadErrorMessage(error), () => {
          void load();
        }),
      );
      more.hidden = true;
      return;
    }
    if (signal.aborted) return;

    for (const session of sessions) dayList(session).append(sessionItem(session));
    loaded += sessions.length;
    from = addDays(to, 1);
    more.disabled = false;
    more.textContent = messages.moreSessions;
    if (sessions.length === 0) {
      // Ein leerer Zeitraum beendet die Liste (Buchungshorizont erreicht).
      status.replaceChildren(
        infoMessage(doc, loaded === 0 ? messages.noSessions : messages.noMoreSessions),
      );
      more.hidden = true;
    } else {
      status.replaceChildren();
      more.hidden = false;
    }
  }

  void load();
  return view;
}
