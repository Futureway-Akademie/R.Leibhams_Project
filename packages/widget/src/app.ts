// Ablaufsteuerung einer Widget-Instanz: Angebote laden, Angebotsliste oder festes Angebot zeigen,
// Auswahl eines Termins merken und als Ereignis am Container melden. Jede Ansicht erhält ein
// eigenes AbortSignal; beim Wechsel oder Entfernen werden laufende Anfragen abgebrochen.
import type { PublicService, PublicServicesResponse } from '@fw-booking/shared';
import type { ApiClient } from './api/client.js';
import type { WidgetConfig } from './config.js';
import { loadErrorMessage, messages } from './messages.js';
import { errorMessage, infoMessage, statusMessage } from './views/common.js';
import { courseView } from './views/course.js';
import { servicesView } from './views/services.js';
import { singleView } from './views/single.js';

/** Ereignis am Container bei jeder Änderung der Auswahl; `detail` ist die Auswahl oder `null`. */
export const SELECT_EVENT = 'fw-booking:select';

/** Gewählter Kurstermin, ohne personenbezogene Daten. */
export interface SessionSelection {
  type: 'group';
  calendarId: string;
  serviceId: string;
  sessionId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/** Gewählter Einzeltermin-Slot, ohne personenbezogene Daten. */
export interface SlotSelection {
  type: 'single';
  calendarId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

export type Selection = SessionSelection | SlotSelection;

export interface App {
  readonly selection: Selection | null;
  destroy(): void;
}

export interface AppOptions {
  container: HTMLElement;
  root: HTMLElement;
  config: WidgetConfig;
  api: ApiClient;
  now: () => Date;
}

export function startApp({ container, root, config, api, now }: AppOptions): App {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let controller = new AbortController();
  let selection: Selection | null = null;
  let destroyed = false;

  /** Beginnt eine neue Ansicht und bricht Anfragen der vorherigen ab. */
  function nextView(): AbortSignal {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
  }

  function show(node: Node) {
    root.replaceChildren(node);
  }

  function setSelection(next: Selection | null) {
    if (next === null && selection === null) return;
    selection = next;
    // CustomEvent des Fensters, zu dem der Container gehört.
    const EventCtor = win?.CustomEvent ?? CustomEvent;
    container.dispatchEvent(new EventCtor(SELECT_EVENT, { bubbles: true, detail: next }));
  }

  async function loadServices(): Promise<void> {
    const signal = nextView();
    show(statusMessage(doc, messages.loading));
    let response: PublicServicesResponse;
    try {
      response = await api.getServices(signal);
    } catch (error) {
      if (signal.aborted) return;
      show(
        errorMessage(doc, loadErrorMessage(error), () => {
          void loadServices();
        }),
      );
      return;
    }
    if (signal.aborted) return;
    route(response);
  }

  function route(response: PublicServicesResponse) {
    const { services, timeZone } = response;
    if (config.serviceId !== null) {
      const service = services.find((s) => s.id === config.serviceId);
      if (service) openService(service, timeZone, null);
      else show(infoMessage(doc, messages.serviceNotFound));
      return;
    }
    if (services.length === 0) {
      show(infoMessage(doc, messages.noServices));
      return;
    }
    const [only] = services;
    if (services.length === 1 && only) {
      openService(only, timeZone, null);
      return;
    }
    const showList = () => {
      nextView();
      setSelection(null);
      show(
        servicesView(doc, services, (service) => {
          openService(service, timeZone, showList);
        }),
      );
    };
    showList();
  }

  function openService(service: PublicService, timeZone: string, back: (() => void) | null) {
    const signal = nextView();
    if (selection !== null && selection.serviceId !== service.id) setSelection(null);
    if (service.type === 'group') {
      show(
        courseView({
          doc,
          api,
          signal,
          service,
          timeZone,
          now,
          back,
          selectedSessionId: selection?.type === 'group' ? selection.sessionId : null,
          onSelect: (session) => {
            setSelection({
              type: 'group',
              calendarId: config.calendarId,
              serviceId: service.id,
              sessionId: session.id,
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              timeZone,
            });
          },
        }),
      );
      return;
    }
    show(
      singleView({
        doc,
        api,
        signal,
        service,
        timeZone,
        now,
        back,
        onSelect: (slot) => {
          setSelection(
            slot === null
              ? null
              : {
                  type: 'single',
                  calendarId: config.calendarId,
                  serviceId: service.id,
                  startsAt: slot.startsAt,
                  endsAt: slot.endsAt,
                  timeZone,
                },
          );
        },
      }),
    );
  }

  void loadServices();

  return {
    get selection() {
      return selection;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
    },
  };
}
