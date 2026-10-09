// Ablaufsteuerung einer Widget-Instanz: Angebote laden, Angebotsliste oder festes Angebot zeigen,
// Auswahl eines Termins merken und als Ereignis am Container melden, danach Formular und
// Bestätigung. Jede Auswahlansicht erhält ein eigenes AbortSignal; beim Wechsel oder Entfernen
// werden laufende Anfragen abgebrochen.
import type {
  BookingConfirmation,
  PublicService,
  PublicServicesResponse,
} from '@fw-booking/shared';
import type { ApiClient } from './api/client.js';
import type { WidgetConfig } from './config.js';
import { button, el } from './dom.js';
import { loadErrorMessage, messages } from './messages.js';
import { localDate } from './time.js';
import type { ParticipantDraft } from './validation.js';
import { bookingForm } from './views/booking-form.js';
import type { BookingForm } from './views/booking-form.js';
import { errorMessage, infoMessage, statusMessage } from './views/common.js';
import { confirmationView } from './views/confirmation.js';
import { courseView } from './views/course.js';
import { servicesView } from './views/services.js';
import { singleView } from './views/single.js';
import { appointmentText } from './views/summary.js';

/** Ereignis am Container bei jeder Änderung der Auswahl; `detail` ist die Auswahl oder `null`. */
export const SELECT_EVENT = 'fw-booking:select';

/** Ereignis am Container nach erfolgreicher Buchung; `detail` ohne personenbezogene Daten. */
export const BOOKED_EVENT = 'fw-booking:booked';

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

/** `detail` von fw-booking:booked. */
export interface BookedDetail {
  calendarId: string;
  bookingId: string;
  type: Selection['type'];
  serviceId: string;
  serviceTitle: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

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

const EMPTY_DRAFT: ParticipantDraft = { name: '', email: '', phone: '' };

interface OpenOptions {
  /** Hinweis über der Auswahl, z. B. nach einem vergebenen Termin. */
  notice?: string;
  /** Bevorzugter Tag der Einzeltermin-Ansicht (nach einem Konflikt). */
  preferredDay?: string;
  /** Verfügbarkeit am Browser-Cache vorbei laden (nach einem Konflikt). */
  fresh?: boolean;
}

export function startApp({ container, root, config, api, now }: AppOptions): App {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let controller = new AbortController();
  let selection: Selection | null = null;
  let services: PublicServicesResponse | null = null;
  let form: BookingForm | null = null;
  /** Eingaben bleiben beim Zurück zur Auswahl und nach einem Konflikt erhalten. */
  let draft: ParticipantDraft = EMPTY_DRAFT;
  /** Aktualisiert die Leiste „Weiter“ der sichtbaren Auswahlansicht. */
  let updateContinue: (() => void) | null = null;
  let destroyed = false;

  /** Beginnt eine neue Ansicht und bricht Anfragen der vorherigen ab. */
  function nextView(): AbortSignal {
    controller.abort();
    controller = new AbortController();
    form?.abort();
    form = null;
    updateContinue = null;
    return controller.signal;
  }

  function show(node: Node) {
    root.replaceChildren(node);
  }

  function emit(type: string, detail: unknown) {
    // CustomEvent des Fensters, zu dem der Container gehört.
    const EventCtor = win?.CustomEvent ?? CustomEvent;
    container.dispatchEvent(new EventCtor(type, { bubbles: true, detail }));
  }

  function setSelection(next: Selection | null) {
    if (next === null && selection === null) return;
    selection = next;
    updateContinue?.();
    emit(SELECT_EVENT, next);
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
    services = response;
    route(response);
  }

  function route(response: PublicServicesResponse) {
    const { services: list, timeZone } = response;
    if (config.serviceId !== null) {
      const service = list.find((s) => s.id === config.serviceId);
      if (service) openService(service, timeZone, null);
      else show(infoMessage(doc, messages.serviceNotFound));
      return;
    }
    if (list.length === 0) {
      show(infoMessage(doc, messages.noServices));
      return;
    }
    const [only] = list;
    if (list.length === 1 && only) {
      openService(only, timeZone, null);
      return;
    }
    const showList = () => {
      nextView();
      setSelection(null);
      show(
        servicesView(doc, list, (service) => {
          openService(service, timeZone, showList);
        }),
      );
    };
    showList();
  }

  function selectionView(
    service: PublicService,
    timeZone: string,
    back: (() => void) | null,
    signal: AbortSignal,
    open: OpenOptions,
  ): HTMLElement {
    const reader = open.fresh === true ? api.fresh() : api;
    if (service.type === 'group') {
      return courseView({
        doc,
        api: reader,
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
      });
    }
    return singleView({
      doc,
      api: reader,
      signal,
      service,
      timeZone,
      now,
      back,
      preferredDay: open.preferredDay ?? null,
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
    });
  }

  function openService(
    service: PublicService,
    timeZone: string,
    back: (() => void) | null,
    open: OpenOptions = {},
  ) {
    const signal = nextView();
    if (selection !== null && selection.serviceId !== service.id) setSelection(null);
    const view = selectionView(service, timeZone, back, signal, open);

    // Leiste „Weiter“: erscheint, sobald ein Termin gewählt ist.
    const chosen = el(doc, 'p', { className: 'chosen' });
    const proceed = button(doc, { className: 'continue', text: messages.continue }, () => {
      if (selection !== null) showForm(service, timeZone, back, step, selection);
    });
    const bar = el(doc, 'div', { className: 'continue-bar' }, [chosen, proceed]);
    const refresh = () => {
      bar.hidden = selection === null;
      chosen.textContent =
        selection === null ? '' : `${messages.chosen} ${appointmentText(service.title, selection)}`;
    };
    refresh();

    const step = el(doc, 'div', { className: 'step' }, [
      open.notice !== undefined &&
        el(doc, 'p', {
          className: ['message', 'message--warning'],
          text: open.notice,
          attrs: { role: 'alert' },
        }),
      view,
      bar,
    ]);
    updateContinue = refresh;
    show(step);
  }

  function showForm(
    service: PublicService,
    timeZone: string,
    back: (() => void) | null,
    step: HTMLElement,
    chosen: Selection,
  ) {
    // Die Auswahlansicht bleibt erhalten (inklusive geladener Daten), das Formular ersetzt sie nur.
    const restore = updateContinue;
    form = bookingForm({
      doc,
      api,
      service,
      selection: chosen,
      privacyUrl: config.privacyUrl,
      draft,
      onDraft: (next) => {
        draft = next;
      },
      onBack: () => {
        form?.abort();
        form = null;
        updateContinue = restore;
        show(step);
      },
      onBooked: (confirmation, email) => {
        booked(service, chosen, confirmation, email);
      },
      onConflict: (message) => {
        setSelection(null);
        openService(service, timeZone, back, {
          notice: message,
          fresh: true,
          ...(chosen.type === 'single'
            ? { preferredDay: localDate(chosen.startsAt, chosen.timeZone) }
            : {}),
        });
      },
    });
    updateContinue = null;
    show(form.node);
  }

  function booked(
    service: PublicService,
    chosen: Selection,
    confirmation: BookingConfirmation,
    email: string,
  ) {
    const detail: BookedDetail = {
      calendarId: config.calendarId,
      bookingId: confirmation.bookingId,
      type: chosen.type,
      serviceId: service.id,
      serviceTitle: confirmation.serviceTitle,
      startsAt: confirmation.startsAt,
      endsAt: confirmation.endsAt,
      timeZone: confirmation.timeZone,
    };
    nextView();
    draft = EMPTY_DRAFT;
    setSelection(null);
    show(
      confirmationView(doc, confirmation, email, () => {
        if (services) route(services);
        else void loadServices();
      }),
    );
    emit(BOOKED_EVENT, detail);
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
      form?.abort();
    },
  };
}
