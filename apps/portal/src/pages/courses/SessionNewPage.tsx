import type { Service } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { requestErrorMessage } from '../../api/messages.js';
import { todayIn } from '../../availability/time.js';
import { formatLocalDateTime } from '../../courses/format.js';
import { useCreateSession } from '../../courses/queries.js';
import { validateNewSession } from '../../courses/session-form.js';
import type { SessionErrors, SessionField, SessionInput } from '../../courses/session-form.js';
import { useTimeZone } from '../../installation.js';
import { Field, focusLater } from '../../layout/Field.js';
import type { FlashState } from '../../layout/flash.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { useServices } from '../../services/queries.js';

type GroupService = Extract<Service, { type: 'group' }>;

export function SessionNewPage(): ReactNode {
  usePageTitle('Neuer Kurstermin');
  const { timeZone, ready } = useTimeZone();
  const services = useServices();
  if (!ready || services.isPending) return <p role="status">Wird geladen …</p>;
  if (services.isError) {
    return (
      <div className="alert alert-error" role="alert">
        <p>Die Angebote konnten nicht geladen werden.</p>
        <button type="button" className="button" onClick={() => void services.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  const groups = services.data.filter((s): s is GroupService => s.type === 'group' && s.active);
  if (groups.length === 0) {
    return (
      <div className="empty">
        <p>Es gibt noch keinen aktiven Gruppenkurs.</p>
        <p>
          <Link to="/angebote/neu">Gruppenkurs anlegen</Link>
        </p>
      </div>
    );
  }
  return <SessionCreateForm timeZone={timeZone} services={groups} />;
}

function SessionCreateForm({
  timeZone,
  services,
}: {
  timeZone: string;
  services: GroupService[];
}): ReactNode {
  const base = useId();
  const create = useCreateSession();
  const navigate = useNavigate();
  const [values, setValues] = useState<SessionInput>(() => ({
    serviceId: services.length === 1 ? (services[0]?.id ?? '') : '',
    date: todayIn(timeZone),
    time: '18:00',
    capacity: '',
    location: '',
  }));
  const [errors, setErrors] = useState<SessionErrors>({});
  const id = (field: SessionField): string => `${base}-${field}`;
  const selected = services.find((s) => s.id === values.serviceId);

  function set(field: SessionField, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (create.isPending) return;
    const result = validateNewSession(values, timeZone);
    if (!result.ok) {
      setErrors(result.errors);
      focusLater(id(result.firstError));
      return;
    }
    setErrors({});
    create.mutate(result.data, {
      onSuccess: () => {
        const text = `Kurstermin am ${formatLocalDateTime(`${values.date}T${values.time}`)} angelegt.`;
        const state: FlashState = { flash: { tone: 'success', text } };
        void navigate(`/kurstermine?woche=${values.date}`, { state });
      },
    });
  }

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/kurstermine">Termine</Link>
      </p>
      <h2>Neuer Kurstermin</h2>
      <form className="form" noValidate onSubmit={handleSubmit}>
        {create.isError && (
          <p className="alert alert-error" role="alert">
            Der Kurstermin wurde nicht angelegt. {requestErrorMessage(create.error)}
          </p>
        )}
        <div className="field">
          <label htmlFor={id('serviceId')}>Gruppenkurs</label>
          <select
            id={id('serviceId')}
            value={values.serviceId}
            aria-invalid={errors.serviceId ? true : undefined}
            aria-describedby={errors.serviceId ? `${id('serviceId')}-error` : undefined}
            onChange={(event) => {
              set('serviceId', event.target.value);
            }}
          >
            <option value="">Bitte wählen</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.title}
              </option>
            ))}
          </select>
          {errors.serviceId && (
            <p id={`${id('serviceId')}-error`} className="field-error">
              {errors.serviceId}
            </p>
          )}
        </div>
        <div className="field-row">
          <Field
            id={id('date')}
            label="Datum"
            type="date"
            value={values.date}
            error={errors.date}
            onChange={(value) => {
              set('date', value);
            }}
          />
          <Field
            id={id('time')}
            label="Beginn"
            type="time"
            step={300}
            value={values.time}
            error={errors.time}
            onChange={(value) => {
              set('time', value);
            }}
          />
        </div>
        <p className="field-hint">
          Zeiten in der Zeitzone {timeZone}.
          {selected && ` Dauer laut Angebot: ${String(selected.durationMinutes)} Minuten.`}
        </p>
        <Field
          id={id('capacity')}
          label={
            <>
              Plätze <span className="muted">(optional)</span>
            </>
          }
          className="field-short"
          type="number"
          inputMode="numeric"
          min={2}
          value={values.capacity}
          error={errors.capacity}
          hint={
            selected
              ? `Leer lassen für den Standard des Angebots (${String(selected.defaultCapacity)} Plätze).`
              : 'Leer lassen für den Standard des Angebots.'
          }
          onChange={(value) => {
            set('capacity', value);
          }}
        />
        <Field
          id={id('location')}
          label={
            <>
              Ort <span className="muted">(optional)</span>
            </>
          }
          type="text"
          maxLength={200}
          value={values.location}
          error={errors.location}
          onChange={(value) => {
            set('location', value);
          }}
        />
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={create.isPending}>
            {create.isPending ? 'Wird angelegt …' : 'Kurstermin anlegen'}
          </button>
          <Link className="button button-secondary" to="/kurstermine">
            Abbrechen
          </Link>
        </div>
      </form>
    </section>
  );
}
