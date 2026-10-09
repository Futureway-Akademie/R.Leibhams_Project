// Schritt „Deine Angaben“: Zusammenfassung des gewählten Termins, Formular mit Name, E-Mail,
// Telefon und Pflicht-Checkbox für die Datenschutzhinweise. Während der Anfrage ist das Absenden
// gesperrt; derselbe Termin mit denselben Angaben verwendet denselben Idempotenzschlüssel.
import type { BookingConfirmation, BookingRequest, PublicService } from '@fw-booking/shared';
import type { ApiClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { Selection } from '../app.js';
import { button, el } from '../dom.js';
import { idempotencyKeys } from '../idempotency.js';
import { bookingErrorMessage, messages } from '../messages.js';
import { fieldsFromApiPaths, validateParticipant } from '../validation.js';
import type { ParticipantDraft, ParticipantField } from '../validation.js';
import { selectionSummary } from './summary.js';

let formCounter = 0;

/** Buchungsanfrage ohne Idempotenzschlüssel, je Terminart (distributiv über die Union). */
type RequestBody = BookingRequest extends infer T
  ? T extends BookingRequest
    ? Omit<T, 'idempotencyKey'>
    : never
  : never;

export interface BookingFormOptions {
  doc: Document;
  api: ApiClient;
  service: PublicService;
  selection: Selection;
  privacyUrl: string;
  /** Vorbelegung, z. B. nach einem Konflikt; wird bei jeder Eingabe aktualisiert. */
  draft: ParticipantDraft;
  onDraft: (draft: ParticipantDraft) => void;
  onBack: () => void;
  onBooked: (confirmation: BookingConfirmation, email: string) => void;
  /** Termin vergeben oder nicht mehr buchbar: zurück zur Auswahl mit Meldung. */
  onConflict: (message: string) => void;
}

export interface BookingForm {
  readonly node: HTMLElement;
  /** Bricht eine laufende Anfrage ab (beim Entfernen des Widgets). */
  abort(): void;
}

const FIELD_MESSAGES: Record<ParticipantField, string> = {
  name: messages.invalidName,
  email: messages.invalidEmail,
  phone: messages.invalidPhone,
  privacy: messages.invalidPrivacy,
};

export function bookingForm(options: BookingFormOptions): BookingForm {
  const { doc, api, service, selection } = options;
  const id = `fw-booking-form-${String(++formCounter)}`;
  const keys = idempotencyKeys();
  let controller: AbortController | null = null;
  let submitting = false;

  function input(
    field: keyof ParticipantDraft,
    type: string,
    autocomplete: string,
    maxLength: number,
  ) {
    const node = el(doc, 'input', {
      className: 'input',
      attrs: {
        id: `${id}-${field}`,
        name: field,
        type,
        autocomplete,
        maxlength: String(maxLength),
        required: '',
        'aria-describedby': `${id}-${field}-error`,
      },
    });
    node.value = options.draft[field];
    node.addEventListener('input', () => {
      clearError(field);
      options.onDraft(readDraft());
    });
    return node;
  }

  const name = input('name', 'text', 'name', 100);
  const email = input('email', 'email', 'email', 254);
  const phone = input('phone', 'tel', 'tel', 20);
  phone.setAttribute('aria-describedby', `${id}-phone-hint ${id}-phone-error`);
  const privacy = el(doc, 'input', {
    className: 'checkbox',
    attrs: {
      id: `${id}-privacy`,
      name: 'privacy',
      type: 'checkbox',
      required: '',
      'aria-describedby': `${id}-privacy-error`,
    },
  });
  privacy.addEventListener('change', () => {
    clearError('privacy');
  });
  const controls: Record<ParticipantField, HTMLInputElement> = { name, email, phone, privacy };

  function errorNode(field: ParticipantField) {
    const node = el(doc, 'p', { className: 'field-error', attrs: { id: `${id}-${field}-error` } });
    node.hidden = true;
    return node;
  }
  const errors: Record<ParticipantField, HTMLElement> = {
    name: errorNode('name'),
    email: errorNode('email'),
    phone: errorNode('phone'),
    privacy: errorNode('privacy'),
  };

  function field(key: keyof ParticipantDraft, label: string, extra?: Node) {
    return el(doc, 'div', { className: 'field' }, [
      el(doc, 'label', { className: 'label', text: label, attrs: { for: `${id}-${key}` } }),
      controls[key],
      extra,
      errors[key],
    ]);
  }

  const status = el(doc, 'div', { className: 'form-status', attrs: { role: 'alert' } });
  const submit = el(doc, 'button', { className: 'submit', text: messages.submit });
  submit.type = 'submit';
  const back = button(doc, { className: 'change', text: messages.changeAppointment }, () => {
    if (!submitting) options.onBack();
  });
  const title = el(doc, 'h3', {
    className: 'form-title',
    text: messages.formTitle,
    attrs: { tabindex: '-1' },
  });

  const form = el(doc, 'form', { className: 'form', attrs: { novalidate: '' } }, [
    field('name', messages.fieldName),
    field('email', messages.fieldEmail),
    field(
      'phone',
      messages.fieldPhone,
      el(doc, 'p', {
        className: 'field-hint',
        text: messages.phoneHint,
        attrs: { id: `${id}-phone-hint` },
      }),
    ),
    el(doc, 'div', { className: ['field', 'field--checkbox'] }, [
      privacy,
      el(doc, 'label', { className: 'label', attrs: { for: `${id}-privacy` } }, [
        messages.privacyBefore,
        el(doc, 'a', {
          className: 'privacy-link',
          text: messages.privacyLink,
          attrs: { href: options.privacyUrl, target: '_blank', rel: 'noopener noreferrer' },
        }),
        messages.privacyAfter,
      ]),
      errors.privacy,
    ]),
    status,
    submit,
  ]);

  const node = el(doc, 'div', { className: ['view', 'booking'] }, [
    back,
    title,
    selectionSummary(doc, service, selection),
    form,
  ]);

  function readDraft(): ParticipantDraft {
    return { name: name.value, email: email.value, phone: phone.value };
  }

  function clearError(field: ParticipantField) {
    controls[field].removeAttribute('aria-invalid');
    errors[field].hidden = true;
    errors[field].textContent = '';
  }

  function showErrors(fields: readonly ParticipantField[]) {
    for (const key of Object.keys(controls) as ParticipantField[]) clearError(key);
    for (const key of fields) {
      controls[key].setAttribute('aria-invalid', 'true');
      errors[key].textContent = FIELD_MESSAGES[key];
      errors[key].hidden = false;
    }
    controls[fields[0] ?? 'name'].focus();
  }

  function setSubmitting(value: boolean) {
    submitting = value;
    submit.disabled = value;
    back.disabled = value;
    submit.textContent = value ? messages.submitting : messages.submit;
    form.setAttribute('aria-busy', String(value));
  }

  function request(draft: ParticipantDraft): RequestBody {
    const participant = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
    };
    return selection.type === 'group'
      ? { type: 'group', sessionId: selection.sessionId, participant, privacyAccepted: true }
      : {
          type: 'single',
          serviceId: selection.serviceId,
          startsAt: selection.startsAt,
          participant,
          privacyAccepted: true,
        };
  }

  async function send(): Promise<void> {
    if (submitting) return;
    status.replaceChildren();
    const draft = readDraft();
    const invalid = validateParticipant(draft, privacy.checked);
    if (invalid.length > 0) {
      showErrors(invalid);
      return;
    }
    const body = request(draft);
    const idempotencyKey = keys.keyFor(JSON.stringify(body));
    setSubmitting(true);
    controller = new AbortController();
    const signal = controller.signal;
    let confirmation: BookingConfirmation;
    try {
      confirmation = await api.createBooking({ ...body, idempotencyKey }, signal);
    } catch (error) {
      if (signal.aborted) return;
      setSubmitting(false);
      const failure = bookingErrorMessage(error);
      if (failure.conflict) {
        options.onConflict(failure.message);
        return;
      }
      if (error instanceof ApiError && error.code === 'idempotency_conflict') keys.reset();
      const fields = error instanceof ApiError ? fieldsFromApiPaths(error.fieldPaths) : [];
      if (fields.length > 0) showErrors(fields);
      status.replaceChildren(
        el(doc, 'p', { className: ['message', 'message--error'], text: failure.message }),
      );
      return;
    }
    if (signal.aborted) return;
    setSubmitting(false);
    options.onBooked(confirmation, body.participant.email);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });

  // Fokus auf die Überschrift, damit Screenreader den Schrittwechsel bemerken.
  queueMicrotask(() => {
    if (node.isConnected) title.focus();
  });

  return {
    node,
    abort() {
      controller?.abort();
    },
  };
}
