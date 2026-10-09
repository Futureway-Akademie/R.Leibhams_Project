// Selbstverwaltung über den Verwaltungslink: eigene Buchung ansehen, stornieren oder umbuchen.
// Storno und Umbuchung brauchen einen eigenen Bestätigungsschritt; das Token liegt nur im
// Arbeitsspeicher dieser Instanz und geht ausschließlich im Header an die API.
import type {
  PublicService,
  PublicSession,
  PublicSlot,
  SelfServiceBooking,
  SelfServiceRebookRequest,
} from '@fw-booking/shared';
import { formatDateTime } from '@fw-booking/shared/format';
import { createManageClient } from '../api/manage-client.js';
import type { ManageClient } from '../api/manage-client.js';
import type { App } from '../app.js';
import type { WidgetConfig } from '../config.js';
import { button, el } from '../dom.js';
import { manageErrorMessage, manageLoadMessage, messages } from '../messages.js';
import { localDate } from '../time.js';
import { errorMessage, statusMessage } from '../views/common.js';
import { courseView } from '../views/course.js';
import { singleView } from '../views/single.js';
import { appointmentText, selectionSummary } from '../views/summary.js';

/** Ereignis am Container nach einem Storno über den Verwaltungslink. */
export const CANCELLED_EVENT = 'fw-booking:cancelled';
/** Ereignis am Container nach einer Umbuchung über den Verwaltungslink. */
export const REBOOKED_EVENT = 'fw-booking:rebooked';

/** `detail` der Verwaltungsereignisse; ohne Token, Name und Kontaktdaten. */
export interface ManageEventDetail {
  calendarId: string;
  type: 'single' | 'group';
  serviceTitle: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

export interface ManageAppOptions {
  container: HTMLElement;
  root: HTMLElement;
  config: WidgetConfig;
  /** `null` bei ungültigem Token im Link. */
  token: string | null;
  fetch?: typeof fetch;
  now: () => Date;
  /** Wechselt den Container zur normalen Buchung („Neuen Termin buchen“). */
  onBookNew: () => void;
}

/** Gewählter neuer Termin für die Umbuchung. */
type RebookTarget =
  { type: 'group'; session: PublicSession } | { type: 'single'; slot: PublicSlot };

export function startManageApp(options: ManageAppOptions): App {
  const { container, root, config } = options;
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const client: ManageClient | null =
    options.token === null
      ? null
      : createManageClient({
          apiUrl: config.apiUrl,
          token: options.token,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
  let controller = new AbortController();
  let destroyed = false;

  function nextView(): AbortSignal {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
  }

  function show(node: Node, focus?: HTMLElement) {
    root.replaceChildren(node);
    // Fokus auf die Überschrift, damit Screenreader den Schrittwechsel bemerken.
    if (focus) {
      queueMicrotask(() => {
        if (focus.isConnected) focus.focus();
      });
    }
  }

  function heading(text: string, className = 'manage-title') {
    return el(doc, 'h3', { className, text, attrs: { tabindex: '-1' } });
  }

  function emit(type: string, booking: SelfServiceBooking) {
    const detail: ManageEventDetail = {
      calendarId: config.calendarId,
      type: booking.type,
      serviceTitle: booking.serviceTitle,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
    };
    const EventCtor = win?.CustomEvent ?? CustomEvent;
    container.dispatchEvent(new EventCtor(type, { bubbles: true, detail }));
  }

  function notice(text: string | undefined, kind: 'warning' | 'info' = 'warning') {
    return (
      text !== undefined &&
      el(doc, 'p', {
        className: ['message', `message--${kind}`],
        text,
        attrs: { role: kind === 'warning' ? 'alert' : 'status' },
      })
    );
  }

  // ---------- Übersicht ----------

  async function loadView(message?: string): Promise<void> {
    if (!client) {
      show(errorMessage(doc, messages.linkInvalid));
      return;
    }
    const signal = nextView();
    show(statusMessage(doc, messages.manageLoading));
    let booking: SelfServiceBooking;
    try {
      booking = await client.view(signal);
    } catch (error) {
      if (signal.aborted) return;
      const text = manageLoadMessage(error);
      const retryable = text !== messages.linkInvalid && text !== messages.linkExpired;
      show(
        errorMessage(
          doc,
          text,
          retryable
            ? () => {
                void loadView(message);
              }
            : undefined,
        ),
      );
      return;
    }
    if (signal.aborted) return;
    showOverview(booking, message);
  }

  function statusText(booking: SelfServiceBooking): string {
    switch (booking.status) {
      case 'confirmed':
        return messages.statusConfirmed;
      case 'cancelled':
        return messages.statusCancelled;
      case 'rebooked':
        return messages.statusRebooked;
      case 'cancelled_by_owner':
        return messages.statusCancelledByOwner;
    }
  }

  function detail(label: string, value: string) {
    return el(doc, 'div', { className: 'detail' }, [
      el(doc, 'dt', { className: 'detail-label', text: label }),
      el(doc, 'dd', { className: 'detail-value', text: value }),
    ]);
  }

  function changeInfo(booking: SelfServiceBooking): string | null {
    if (booking.status !== 'confirmed') return null;
    if (!booking.canCancel && !booking.canRebook) return messages.changeClosed;
    const until = messages.changeUntil(formatDateTime(booking.changeDeadline, booking.timeZone));
    return booking.canRebook ? until : `${until} ${messages.rebookUsed}`;
  }

  function showOverview(booking: SelfServiceBooking, message?: string) {
    nextView();
    const title = heading(messages.manageTitle);
    const info = changeInfo(booking);
    const actions = el(doc, 'div', { className: 'manage-actions' }, [
      booking.canRebook &&
        button(doc, { className: 'rebook', text: messages.rebookAction }, () => {
          showRebookSelection(booking);
        }),
      booking.canCancel &&
        button(doc, { className: 'cancel', text: messages.cancelAction }, () => {
          showCancelConfirm(booking);
        }),
      booking.status !== 'confirmed' &&
        button(doc, { className: 'book-another', text: messages.bookNew }, options.onBookNew),
    ]);
    show(
      el(doc, 'div', { className: ['view', 'manage'] }, [
        title,
        notice(message),
        selectionSummary(doc, { title: booking.serviceTitle }, booking),
        el(doc, 'dl', { className: 'details' }, [
          detail(messages.bookedFor, booking.participantName),
          booking.location !== null &&
            booking.location !== '' &&
            detail(messages.location, booking.location),
          detail(messages.status, statusText(booking)),
        ]),
        info !== null && el(doc, 'p', { className: 'hint', text: info }),
        actions.childElementCount > 0 && actions,
        el(doc, 'p', { className: ['hint', 'reload-hint'], text: messages.reloadHint }),
      ]),
      title,
    );
  }

  // ---------- Bestätigungsschritt ----------

  interface ConfirmOptions {
    question: string;
    confirmLabel: string;
    /** Unumkehrbare Aktion (Storno): Schaltfläche in der Warnfarbe. */
    danger?: boolean;
    body: Node[];
    run: (signal: AbortSignal) => Promise<void>;
    onCancel: () => void;
  }

  function showConfirm(confirm: ConfirmOptions) {
    const signal = nextView();
    const title = heading(confirm.question, 'confirm-title');
    const status = el(doc, 'div', { className: 'form-status', attrs: { role: 'alert' } });
    const abort = button(doc, { className: 'abort', text: messages.abort }, () => {
      if (!busy) confirm.onCancel();
    });
    let busy = false;
    const proceed = button(
      doc,
      {
        className: confirm.danger === true ? ['confirm', 'confirm--danger'] : 'confirm',
        text: confirm.confirmLabel,
      },
      () => {
        if (busy) return;
        busy = true;
        abort.disabled = true;
        proceed.disabled = true;
        proceed.textContent = messages.processing;
        status.replaceChildren();
        confirm.run(signal).catch((error: unknown) => {
          if (signal.aborted) return;
          busy = false;
          abort.disabled = false;
          proceed.disabled = false;
          proceed.textContent = confirm.confirmLabel;
          status.replaceChildren(
            el(doc, 'p', {
              className: ['message', 'message--error'],
              text: manageErrorMessage(error).message,
            }),
          );
        });
      },
    );
    show(
      el(doc, 'div', { className: ['view', 'manage-confirm'] }, [
        title,
        ...confirm.body,
        status,
        // „Abbrechen“ zuerst: die harmlose Wahl liegt in der Tab-Reihenfolge vorn.
        el(doc, 'div', { className: 'manage-actions' }, [abort, proceed]),
      ]),
      title,
    );
  }

  function showDone(titleText: string, booking: SelfServiceBooking, next: Node) {
    nextView();
    const title = heading(titleText, 'confirmation-title');
    show(
      el(doc, 'div', { className: ['view', 'confirmation'], attrs: { role: 'status' } }, [
        title,
        selectionSummary(doc, { title: booking.serviceTitle }, booking),
        el(doc, 'p', { className: 'confirmation-mail', text: messages.changeMail }),
        next,
      ]),
      title,
    );
  }

  // ---------- Storno ----------

  function showCancelConfirm(booking: SelfServiceBooking) {
    showConfirm({
      question: messages.cancelQuestion,
      confirmLabel: messages.cancelConfirm,
      danger: true,
      body: [selectionSummary(doc, { title: booking.serviceTitle }, booking)],
      onCancel: () => {
        showOverview(booking);
      },
      run: async (signal) => {
        if (!client) return;
        const result = await client.cancel(signal);
        if (signal.aborted) return;
        showDone(
          messages.cancelledTitle,
          result,
          button(doc, { className: 'book-another', text: messages.bookNew }, options.onBookNew),
        );
        emit(CANCELLED_EVENT, result);
      },
    });
  }

  // ---------- Umbuchung ----------

  function serviceOf(booking: SelfServiceBooking): PublicService {
    const durationMinutes = Math.round(
      (Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000,
    );
    // Die Angebots-ID ist für die Verwaltungsabfragen nicht nötig (das Token bestimmt das Angebot).
    return booking.type === 'group'
      ? { id: '', type: 'group', title: booking.serviceTitle, description: null, durationMinutes }
      : { id: '', type: 'single', title: booking.serviceTitle, description: null, durationMinutes };
  }

  function timeOf(target: RebookTarget, timeZone: string) {
    const item = target.type === 'group' ? target.session : target.slot;
    return { startsAt: item.startsAt, endsAt: item.endsAt, timeZone };
  }

  function showRebookSelection(
    booking: SelfServiceBooking,
    message?: string,
    fresh = false,
    preferredDay?: string,
  ) {
    if (!client) return;
    const signal = nextView();
    const service = serviceOf(booking);
    const reader = (fresh ? client.fresh() : client).options();
    const back = () => {
      showOverview(booking);
    };
    let target: RebookTarget | null = null;

    const chosen = el(doc, 'p', { className: 'chosen' });
    const proceed = button(doc, { className: 'continue', text: messages.continue }, () => {
      if (target) showRebookConfirm(booking, target);
    });
    proceed.textContent = messages.rebookAction;
    const bar = el(doc, 'div', { className: 'continue-bar' }, [chosen, proceed]);
    const refresh = () => {
      bar.hidden = target === null;
      chosen.textContent =
        target === null
          ? ''
          : `${messages.chosen} ${appointmentText(booking.serviceTitle, timeOf(target, booking.timeZone))}`;
    };
    refresh();

    const view =
      service.type === 'group'
        ? courseView({
            doc,
            api: reader,
            signal,
            service,
            timeZone: booking.timeZone,
            now: options.now,
            back: null,
            selectedSessionId: null,
            onSelect: (session) => {
              target = { type: 'group', session };
              refresh();
            },
          })
        : singleView({
            doc,
            api: reader,
            signal,
            service,
            timeZone: booking.timeZone,
            now: options.now,
            back: null,
            preferredDay: preferredDay ?? localDate(booking.startsAt, booking.timeZone),
            onSelect: (slot) => {
              target = slot === null ? null : { type: 'single', slot };
              refresh();
            },
          });

    const title = heading(messages.chooseNewAppointment);
    show(
      el(doc, 'div', { className: ['step', 'manage-rebook'] }, [
        button(doc, { className: 'back', text: messages.backToBooking }, back),
        title,
        notice(message),
        el(doc, 'p', { className: 'hint' }, [
          `${messages.previousAppointment} ${appointmentText(booking.serviceTitle, booking)}`,
        ]),
        view,
        bar,
      ]),
      message === undefined ? undefined : title,
    );
  }

  function showRebookConfirm(booking: SelfServiceBooking, target: RebookTarget) {
    const time = timeOf(target, booking.timeZone);
    const request: SelfServiceRebookRequest =
      target.type === 'group'
        ? { type: 'group', sessionId: target.session.id, confirm: true }
        : { type: 'single', startsAt: target.slot.startsAt, confirm: true };
    showConfirm({
      question: messages.rebookQuestion,
      confirmLabel: messages.rebookConfirm,
      body: [
        el(doc, 'dl', { className: 'details' }, [
          detail(messages.previousAppointment, appointmentText(booking.serviceTitle, booking)),
          detail(messages.newAppointment, appointmentText(booking.serviceTitle, time)),
        ]),
      ],
      onCancel: () => {
        showRebookSelection(booking);
      },
      run: async (signal) => {
        if (!client) return;
        try {
          const result = await client.rebook(request, signal);
          if (signal.aborted) return;
          showDone(
            messages.rebookedTitle,
            result,
            button(doc, { className: 'back-to-booking', text: messages.backToBooking }, () => {
              void loadView();
            }),
          );
          emit(REBOOKED_EVENT, result);
        } catch (error) {
          const failure = manageErrorMessage(error);
          if (!signal.aborted && failure.conflict) {
            // Ziel inzwischen vergeben: zurück zur Auswahl mit frischen Daten.
            showRebookSelection(
              booking,
              failure.message,
              true,
              target.type === 'single'
                ? localDate(target.slot.startsAt, booking.timeZone)
                : undefined,
            );
            return;
          }
          throw error;
        }
      },
    });
  }

  void loadView();

  return {
    get selection() {
      return null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
    },
  };
}
