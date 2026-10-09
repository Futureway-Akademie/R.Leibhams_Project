import type { Service } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/client.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { SERVICE_TYPE_HINTS, SERVICE_TYPE_LABELS, formatDuration } from '../../services/format.js';
import type { ServiceType } from '../../services/format.js';
import {
  emptyServiceForm,
  fieldErrorsFromPaths,
  ruleUnit,
  serviceToForm,
  servicePatch,
  validateServiceForm,
} from '../../services/form.js';
import type { FieldErrors, FieldName, RuleKey, ServiceFormValues } from '../../services/form.js';
import { mutationErrorMessage } from '../../services/messages.js';
import { useCreateService, useService, useUpdateService } from '../../services/queries.js';
import type { ServiceListState } from './ServiceListPage.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;
const TYPES: readonly ServiceType[] = ['single', 'group'];

const RULE_FIELDS: readonly { key: RuleKey; label: string; hint: string }[] = [
  {
    key: 'minLeadMinutes',
    label: 'Mindestvorlauf',
    hint: 'Wie viele Stunden vor Beginn spätestens gebucht werden kann.',
  },
  {
    key: 'horizonDays',
    label: 'Buchungshorizont',
    hint: 'Wie viele Tage im Voraus gebucht werden kann.',
  },
  {
    key: 'changeDeadlineMinutes',
    label: 'Frist für Storno und Umbuchung',
    hint: 'Bis wie viele Stunden vor Beginn Kunden selbst stornieren oder umbuchen können.',
  },
];

function fieldId(base: string, field: FieldName): string {
  return `${base}-${field.replace('.', '-')}`;
}

export function NewServicePage(): ReactNode {
  usePageTitle('Neues Angebot');
  const create = useCreateService();
  const navigate = useNavigate();

  return (
    <ServiceForm
      heading="Neues Angebot"
      initial={emptyServiceForm('single')}
      original={null}
      pending={create.isPending}
      onSubmit={(data, fail) => {
        create.mutate(data, {
          onSuccess: (service) => {
            const state: ServiceListState = { notice: `Angebot „${service.title}“ angelegt.` };
            void navigate('/angebote', { state });
          },
          onError: fail,
        });
      }}
    />
  );
}

export function EditServicePage(): ReactNode {
  const { serviceId = '' } = useParams();
  const validId = OBJECT_ID.test(serviceId);
  if (!validId) return <ServiceNotFound />;
  return <EditServiceLoader id={serviceId} />;
}

function EditServiceLoader({ id }: { id: string }): ReactNode {
  const service = useService(id);
  const update = useUpdateService();
  const navigate = useNavigate();
  usePageTitle(service.data ? service.data.title : 'Angebot bearbeiten');

  if (service.isPending) return <p role="status">Angebot wird geladen …</p>;
  if (service.isError) {
    if (isApiError(service.error, 404) || isApiError(service.error, 400)) {
      return <ServiceNotFound />;
    }
    return (
      <div className="alert alert-error" role="alert">
        <p>Das Angebot konnte nicht geladen werden.</p>
        <button type="button" className="button" onClick={() => void service.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  const original = service.data;
  return (
    <ServiceForm
      // Neu aufbauen, wenn ein anderes Angebot geladen wird.
      key={original.id}
      heading="Angebot bearbeiten"
      initial={serviceToForm(original)}
      original={original}
      pending={update.isPending}
      onSubmit={(data, fail) => {
        const patch = servicePatch(original, data);
        if (!patch) {
          const state: ServiceListState = { notice: 'Keine Änderungen.' };
          void navigate('/angebote', { state });
          return;
        }
        update.mutate(
          { id: original.id, patch },
          {
            onSuccess: (saved) => {
              const state: ServiceListState = { notice: `Angebot „${saved.title}“ gespeichert.` };
              void navigate('/angebote', { state });
            },
            onError: fail,
          },
        );
      }}
    />
  );
}

function ServiceNotFound(): ReactNode {
  usePageTitle('Angebot nicht gefunden');
  return (
    <section>
      <h1>Angebot nicht gefunden</h1>
      <p>
        <Link to="/angebote">Zur Angebotsliste</Link>
      </p>
    </section>
  );
}

interface ServiceFormProps {
  heading: string;
  initial: ServiceFormValues;
  /** Gespeichertes Angebot beim Bearbeiten; `null` beim Anlegen (Terminart wählbar). */
  original: Service | null;
  pending: boolean;
  onSubmit: (data: Parameters<typeof servicePatch>[1], fail: (error: unknown) => void) => void;
}

function ServiceForm({
  heading,
  initial,
  original,
  pending,
  onSubmit,
}: ServiceFormProps): ReactNode {
  const base = useId();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasCustomRule = Object.values(initial.rules).some((rule) => !rule.useDefault);
  const [advancedOpen, setAdvancedOpen] = useState(hasCustomRule);

  function set<K extends keyof ServiceFormValues>(key: K, value: ServiceFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setRule(key: RuleKey, patch: Partial<ServiceFormValues['rules'][RuleKey]>): void {
    setValues((current) => ({
      ...current,
      rules: { ...current.rules, [key]: { ...current.rules[key], ...patch } },
    }));
  }

  function focusField(field: FieldName): void {
    if (field.startsWith('bookingRules.')) setAdvancedOpen(true);
    // Nach dem Rendern (aufgeklappter Bereich, Fehlermeldungen) fokussieren.
    requestAnimationFrame(() => {
      document.getElementById(fieldId(base, field))?.focus();
    });
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    setSubmitError(null);
    const result = validateServiceForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      focusField(result.firstError);
      return;
    }
    setErrors({});
    onSubmit(result.data, (error) => {
      setSubmitError(`Das Angebot wurde nicht gespeichert. ${mutationErrorMessage(error)}`);
      if (isApiError(error, 400)) {
        const serverErrors = fieldErrorsFromPaths(error.fieldPaths);
        setErrors(serverErrors);
        const first = Object.keys(serverErrors)[0] as FieldName | undefined;
        if (first) focusField(first);
      }
    });
  }

  function describedBy(field: FieldName, hintId?: string): string | undefined {
    const ids = [hintId, errors[field] ? `${fieldId(base, field)}-error` : undefined].filter(
      Boolean,
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function errorText(field: FieldName): ReactNode {
    const message = errors[field];
    return message ? (
      <p id={`${fieldId(base, field)}-error`} className="field-error">
        {message}
      </p>
    ) : null;
  }

  const duration = Number(values.durationMinutes);
  // Ab einer Stunde zusätzlich lesbar, z. B. „Entspricht 1 Std. 30 Min.“
  const durationHint =
    Number.isInteger(duration) && duration >= 60 ? `Entspricht ${formatDuration(duration)}.` : null;

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/angebote">Angebote</Link>
      </p>
      <h1>{heading}</h1>
      <form className="form" noValidate onSubmit={handleSubmit}>
        {submitError && (
          <p className="alert alert-error" role="alert">
            {submitError}
          </p>
        )}

        {original === null ? (
          <fieldset className="field choice-group">
            <legend>Terminart</legend>
            {TYPES.map((type) => (
              <label key={type} className="choice">
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={values.type === type}
                  onChange={() => {
                    setValues((current) => ({
                      ...current,
                      type,
                      defaultCapacity:
                        type === 'group' && current.defaultCapacity === ''
                          ? '10'
                          : current.defaultCapacity,
                    }));
                  }}
                />
                <span>
                  <strong>{SERVICE_TYPE_LABELS[type]}</strong>
                  <span className="muted">{SERVICE_TYPE_HINTS[type]}</span>
                </span>
              </label>
            ))}
            <p className="field-hint">
              Die Terminart kann nach dem Anlegen nicht mehr geändert werden.
            </p>
          </fieldset>
        ) : (
          <div className="field">
            <span className="field-label">Terminart</span>
            <p className="field-static">
              {SERVICE_TYPE_LABELS[original.type]}{' '}
              <span className="muted">(nach dem Anlegen nicht änderbar)</span>
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor={fieldId(base, 'title')}>Titel</label>
          <input
            id={fieldId(base, 'title')}
            type="text"
            maxLength={120}
            required
            value={values.title}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy('title')}
            onChange={(event) => {
              set('title', event.target.value);
            }}
          />
          {errorText('title')}
        </div>

        <div className="field">
          <label htmlFor={fieldId(base, 'description')}>
            Beschreibung <span className="muted">(optional)</span>
          </label>
          <textarea
            id={fieldId(base, 'description')}
            rows={4}
            maxLength={2000}
            value={values.description}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy('description')}
            onChange={(event) => {
              set('description', event.target.value);
            }}
          />
          {errorText('description')}
        </div>

        <div className="field">
          <label htmlFor={fieldId(base, 'durationMinutes')}>Dauer in Minuten</label>
          <input
            id={fieldId(base, 'durationMinutes')}
            className="input-short"
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            required
            value={values.durationMinutes}
            aria-invalid={errors.durationMinutes ? true : undefined}
            aria-describedby={describedBy('durationMinutes', `${base}-duration-hint`)}
            onChange={(event) => {
              set('durationMinutes', event.target.value);
            }}
          />
          <p id={`${base}-duration-hint`} className="field-hint">
            {values.type === 'single'
              ? 'Inklusive eventueller Pufferzeit (z. B. Aufräumen); 5-Minuten-Schritte.'
              : 'Dauer eines Kurstermins; 5-Minuten-Schritte.'}{' '}
            {durationHint}
          </p>
          {errorText('durationMinutes')}
        </div>

        {values.type === 'group' && (
          <div className="field">
            <label htmlFor={fieldId(base, 'defaultCapacity')}>Plätze je Kurstermin</label>
            <input
              id={fieldId(base, 'defaultCapacity')}
              className="input-short"
              type="number"
              inputMode="numeric"
              min={2}
              step={1}
              required
              value={values.defaultCapacity}
              aria-invalid={errors.defaultCapacity ? true : undefined}
              aria-describedby={describedBy('defaultCapacity', `${base}-capacity-hint`)}
              onChange={(event) => {
                set('defaultCapacity', event.target.value);
              }}
            />
            <p id={`${base}-capacity-hint`} className="field-hint">
              Standard für neue Kurstermine; je Termin anpassbar.
            </p>
            {errorText('defaultCapacity')}
          </div>
        )}

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => {
                set('active', event.target.checked);
              }}
            />
            <span>Aktiv (im Buchungs-Widget sichtbar)</span>
          </label>
        </div>

        <details
          className="advanced"
          open={advancedOpen}
          onToggle={(event) => {
            setAdvancedOpen(event.currentTarget.open);
          }}
        >
          <summary>Erweitert: Buchungsfristen</summary>
          <p className="field-hint">
            Ohne eigenen Wert gelten die Standardfristen der Installation.
          </p>
          {RULE_FIELDS.map(({ key, label, hint }) => {
            const field: FieldName = `bookingRules.${key}`;
            const rule = values.rules[key];
            const unit = ruleUnit(key) === 'hours' ? 'Stunden' : 'Tage';
            const unitDative = ruleUnit(key) === 'hours' ? 'Stunden' : 'Tagen';
            const hintId = `${fieldId(base, field)}-hint`;
            return (
              <fieldset key={key} className="field rule">
                <legend>{label}</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={rule.useDefault}
                    onChange={(event) => {
                      setRule(key, { useDefault: event.target.checked });
                    }}
                  />
                  <span>Standard der Installation</span>
                </label>
                {!rule.useDefault && (
                  <>
                    <label htmlFor={fieldId(base, field)} className="visually-hidden">
                      {label} in {unitDative}
                    </label>
                    <span className="input-with-unit">
                      <input
                        id={fieldId(base, field)}
                        className="input-short"
                        type="text"
                        inputMode={ruleUnit(key) === 'hours' ? 'decimal' : 'numeric'}
                        value={rule.value}
                        aria-invalid={errors[field] ? true : undefined}
                        aria-describedby={describedBy(field, hintId)}
                        onChange={(event) => {
                          setRule(key, { value: event.target.value });
                        }}
                      />
                      <span aria-hidden="true">{unit}</span>
                    </span>
                  </>
                )}
                <p id={hintId} className="field-hint">
                  {hint}
                </p>
                {!rule.useDefault && errorText(field)}
              </fieldset>
            );
          })}
        </details>

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? 'Wird gespeichert …' : original ? 'Speichern' : 'Angebot anlegen'}
          </button>
          <Link className="button button-secondary" to="/angebote">
            Abbrechen
          </Link>
        </div>
      </form>
    </section>
  );
}
