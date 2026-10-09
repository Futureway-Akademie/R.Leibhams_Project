import type { AvailabilityException } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { requestErrorMessage } from '../../api/messages.js';
import { emptyException, validateException } from '../../availability/exception-form.js';
import type {
  ExceptionErrors,
  ExceptionField,
  ExceptionInput,
} from '../../availability/exception-form.js';
import {
  useCreateException,
  useDeleteException,
  useExceptions,
} from '../../availability/queries.js';
import { formatLocalRange, todayIn } from '../../availability/time.js';

const KIND_LABELS: Record<AvailabilityException['kind'], string> = {
  closed: 'Geschlossen',
  extra_opening: 'Zusätzlich geöffnet',
};

type Notice = { tone: 'success' | 'warning'; text: string };

function createdNotice(kind: AvailabilityException['kind'], conflicts: number): Notice {
  if (kind === 'closed' && conflicts > 0) {
    const bookings =
      conflicts === 1
        ? '1 bestätigte Buchung liegt'
        : `${String(conflicts)} bestätigte Buchungen liegen`;
    return {
      tone: 'warning',
      text: `Ausnahme angelegt. Achtung: ${bookings} im gesperrten Zeitraum. Buchungen werden nicht automatisch abgesagt – bitte unter „Buchungen“ prüfen und bei Bedarf absagen.`,
    };
  }
  return { tone: 'success', text: 'Ausnahme angelegt.' };
}

export function ExceptionsSection({ timeZone }: { timeZone: string }): ReactNode {
  const exceptions = useExceptions();
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <section aria-labelledby="exceptions-heading" className="section">
      <h2 id="exceptions-heading">Ausnahmen</h2>
      <p className="muted">
        Ausnahmen haben Vorrang vor dem Wochenplan, z. B. Urlaub oder ein zusätzlicher Samstag.
      </p>

      <ExceptionForm
        timeZone={timeZone}
        onCreated={(next) => {
          setNotice(next);
        }}
        onEdit={() => {
          setNotice(null);
        }}
      />

      {notice && (
        <p
          className={notice.tone === 'success' ? 'alert alert-success' : 'alert alert-warning'}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <h3>Anstehende Ausnahmen</h3>
      {exceptions.isPending && <p role="status">Ausnahmen werden geladen …</p>}
      {exceptions.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Ausnahmen konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void exceptions.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {exceptions.isSuccess && exceptions.data.length === 0 && (
        <p className="muted">Keine anstehenden Ausnahmen.</p>
      )}
      {exceptions.isSuccess && exceptions.data.length > 0 && (
        <ul className="item-list" aria-label="Anstehende Ausnahmen">
          {exceptions.data.map((exception) => (
            <ExceptionItem
              key={exception.id}
              exception={exception}
              onDeleted={() => {
                setNotice({ tone: 'success', text: 'Ausnahme entfernt.' });
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExceptionItem({
  exception,
  onDeleted,
}: {
  exception: AvailabilityException;
  onDeleted: () => void;
}): ReactNode {
  const remove = useDeleteException();
  const [confirming, setConfirming] = useState(false);
  const range = formatLocalRange(exception.start, exception.end);

  return (
    <li className="item">
      <div className="item-main">
        <span className="item-title">{range}</span>
        <span className="item-meta">
          <span className={exception.kind === 'closed' ? 'badge badge-closed' : 'badge badge-open'}>
            {KIND_LABELS[exception.kind]}
          </span>
          {exception.note && <span className="item-note">{exception.note}</span>}
        </span>
        {remove.isError && (
          <p className="field-error" role="alert">
            Nicht entfernt. {requestErrorMessage(remove.error)}
          </p>
        )}
      </div>
      <div className="item-actions">
        {confirming ? (
          <>
            <span className="muted">Wirklich entfernen?</span>
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending}
              aria-label={`Ausnahme ${range} endgültig entfernen`}
              onClick={() => {
                remove.mutate(exception.id, { onSuccess: onDeleted });
              }}
            >
              {remove.isPending ? 'Wird entfernt …' : 'Entfernen'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(false);
                remove.reset();
              }}
            >
              Abbrechen
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            aria-label={`Ausnahme ${range} entfernen`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Entfernen
          </button>
        )}
      </div>
    </li>
  );
}

function ExceptionForm({
  timeZone,
  onCreated,
  onEdit,
}: {
  timeZone: string;
  onCreated: (notice: Notice) => void;
  onEdit: () => void;
}): ReactNode {
  const base = useId();
  const create = useCreateException();
  const [values, setValues] = useState<ExceptionInput>(() => emptyException(todayIn(timeZone)));
  const [errors, setErrors] = useState<ExceptionErrors>({});

  const id = (field: ExceptionField): string => `${base}-${field}`;

  function set<K extends keyof ExceptionInput>(key: K, value: ExceptionInput[K]): void {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // Ende nicht vor dem Beginn stehen lassen, wenn der Beginn verschoben wird.
      if (key === 'startDate' && typeof value === 'string' && next.endDate < value) {
        next.endDate = value;
      }
      return next;
    });
    onEdit();
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (create.isPending) return;
    const validation = validateException(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      requestAnimationFrame(() => {
        document.getElementById(id(validation.firstError))?.focus();
      });
      return;
    }
    setErrors({});
    create.mutate(validation.data, {
      onSuccess: ({ exception, conflictingBookings }) => {
        onCreated(createdNotice(exception.kind, conflictingBookings));
        setValues((current) => ({ ...emptyException(todayIn(timeZone)), kind: current.kind }));
      },
    });
  }

  function field(
    name: ExceptionField,
    label: string,
    type: 'date' | 'time',
    value: string,
  ): ReactNode {
    const error = errors[name];
    return (
      <div className="field">
        <label htmlFor={id(name)}>{label}</label>
        <input
          id={id(name)}
          type={type}
          step={type === 'time' ? 300 : undefined}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id(name)}-error` : undefined}
          onChange={(event) => {
            set(name, event.target.value);
          }}
        />
        {error && (
          <p id={`${id(name)}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="form exception-form" noValidate onSubmit={handleSubmit}>
      <h3>Ausnahme hinzufügen</h3>
      {create.isError && (
        <p className="alert alert-error" role="alert">
          Die Ausnahme wurde nicht angelegt. {requestErrorMessage(create.error)}
        </p>
      )}
      <fieldset className="field choice-group choice-group-inline">
        <legend>Art</legend>
        {(['closed', 'extra_opening'] as const).map((kind) => (
          <label key={kind} className="choice">
            <input
              type="radio"
              name={`${base}-kind`}
              checked={values.kind === kind}
              onChange={() => {
                set('kind', kind);
              }}
            />
            <span>
              <strong>{KIND_LABELS[kind]}</strong>
              <span className="muted">
                {kind === 'closed'
                  ? 'z. B. Urlaub, Feiertag, Termin außer Haus'
                  : 'außerhalb des Wochenplans buchbar'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={values.allDay}
          onChange={(event) => {
            set('allDay', event.target.checked);
          }}
        />
        <span>Ganztägig</span>
      </label>

      <div className="field-row">
        {field(
          'startDate',
          values.allDay ? 'Von (Datum)' : 'Beginn (Datum)',
          'date',
          values.startDate,
        )}
        {!values.allDay && field('startTime', 'Beginn (Uhrzeit)', 'time', values.startTime)}
      </div>
      <div className="field-row">
        {field(
          'endDate',
          values.allDay ? 'Bis einschließlich (Datum)' : 'Ende (Datum)',
          'date',
          values.endDate,
        )}
        {!values.allDay && field('endTime', 'Ende (Uhrzeit)', 'time', values.endTime)}
      </div>

      <div className="field">
        <label htmlFor={id('note')}>
          Notiz <span className="muted">(optional, nur intern)</span>
        </label>
        <input
          id={id('note')}
          type="text"
          maxLength={200}
          value={values.note}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? `${id('note')}-error` : undefined}
          onChange={(event) => {
            set('note', event.target.value);
          }}
        />
        {errors.note && (
          <p id={`${id('note')}-error`} className="field-error">
            {errors.note}
          </p>
        )}
      </div>

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={create.isPending}>
          {create.isPending ? 'Wird angelegt …' : 'Ausnahme hinzufügen'}
        </button>
      </div>
    </form>
  );
}
