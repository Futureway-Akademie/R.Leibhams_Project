import type { CourseGenerationReport, CourseRule, Service } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/client.js';
import { requestErrorMessage } from '../../api/messages.js';
import { ISO_WEEKDAYS, WEEKDAY_NAMES, todayIn } from '../../availability/time.js';
import { formatLocalDateTime, reportLines } from '../../courses/format.js';
import {
  useCourseRule,
  useCreateRule,
  useDeleteRule,
  useUpdateRule,
} from '../../courses/queries.js';
import { emptyRule, rulePatch, ruleToInput, validateRule } from '../../courses/rule-form.js';
import type { RuleErrors, RuleField, RuleInput } from '../../courses/rule-form.js';
import { useTimeZone } from '../../installation.js';
import { Field, focusLater } from '../../layout/Field.js';
import type { FlashState } from '../../layout/flash.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { useServices } from '../../services/queries.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;
const RULES_PATH = '/kurstermine/regeln';

type GroupService = Extract<Service, { type: 'group' }>;

/** Hinweis mit Erzeugungsbericht für die Regelliste. */
function reportFlash(text: string, report: CourseGenerationReport): FlashState {
  const lines = reportLines(report);
  return {
    flash: {
      tone: report.conflicts.length > 0 ? 'warning' : 'success',
      text: `${text} ${lines.summary}`,
      details: [
        { title: 'Übersprungen, weil die Zeit bereits belegt ist:', items: lines.conflicts },
        { title: 'Unverändert, weil bereits gebucht:', items: lines.kept },
      ],
    },
  };
}

export function RuleNewPage(): ReactNode {
  usePageTitle('Neue Kursregel');
  const { timeZone, ready } = useTimeZone();
  const services = useServices();
  const create = useCreateRule();
  const navigate = useNavigate();
  if (!ready || services.isPending) return <p role="status">Wird geladen …</p>;
  const groups = (services.data ?? []).filter(
    (s): s is GroupService => s.type === 'group' && s.active,
  );
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
  const initial = emptyRule(todayIn(timeZone));
  if (groups.length === 1) initial.serviceId = groups[0]?.id ?? '';

  return (
    <RuleForm
      heading="Neue Kursregel"
      initial={initial}
      original={null}
      services={groups}
      pending={create.isPending}
      error={create.error}
      onSubmit={(data) => {
        create.mutate(data, {
          onSuccess: ({ generation }) => {
            void navigate(RULES_PATH, { state: reportFlash('Regel angelegt.', generation) });
          },
        });
      }}
    />
  );
}

export function RuleEditPage(): ReactNode {
  const { ruleId = '' } = useParams();
  if (!OBJECT_ID.test(ruleId)) return <RuleNotFound />;
  return <RuleEditLoader id={ruleId} />;
}

function RuleNotFound(): ReactNode {
  usePageTitle('Kursregel nicht gefunden');
  return (
    <section>
      <h2>Kursregel nicht gefunden</h2>
      <p>
        <Link to={RULES_PATH}>Zu den Regeln</Link>
      </p>
    </section>
  );
}

function RuleEditLoader({ id }: { id: string }): ReactNode {
  usePageTitle('Kursregel bearbeiten');
  const rule = useCourseRule(id);
  const services = useServices();
  const update = useUpdateRule();
  const navigate = useNavigate();

  if (rule.isPending || services.isPending) return <p role="status">Regel wird geladen …</p>;
  if (rule.isError) {
    if (isApiError(rule.error, 404) || isApiError(rule.error, 400)) return <RuleNotFound />;
    return (
      <div className="alert alert-error" role="alert">
        <p>Die Regel konnte nicht geladen werden.</p>
        <button type="button" className="button" onClick={() => void rule.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  const original = rule.data;
  const groups = (services.data ?? []).filter((s): s is GroupService => s.type === 'group');

  return (
    <>
      <RuleForm
        key={original.id}
        heading="Kursregel bearbeiten"
        initial={ruleToInput(original)}
        original={original}
        services={groups}
        pending={update.isPending}
        error={update.error}
        onSubmit={(data) => {
          const patch = rulePatch(original, data);
          if (!patch) {
            const state: FlashState = { flash: { tone: 'success', text: 'Keine Änderungen.' } };
            void navigate(RULES_PATH, { state });
            return;
          }
          update.mutate(
            { id: original.id, patch },
            {
              onSuccess: ({ generation }) => {
                void navigate(RULES_PATH, { state: reportFlash('Regel gespeichert.', generation) });
              },
            },
          );
        }}
      />
      <RuleDeletePanel rule={original} />
    </>
  );
}

function RuleForm({
  heading,
  initial,
  original,
  services,
  pending,
  error,
  onSubmit,
}: {
  heading: string;
  initial: RuleInput;
  original: CourseRule | null;
  services: GroupService[];
  pending: boolean;
  error: unknown;
  onSubmit: (data: Extract<ReturnType<typeof validateRule>, { ok: true }>['data']) => void;
}): ReactNode {
  const base = useId();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<RuleErrors>({});
  const id = (field: RuleField): string => `${base}-${field}`;
  const selected = services.find((s) => s.id === values.serviceId);

  function set<K extends keyof RuleInput>(key: K, value: RuleInput[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    const result = validateRule(values);
    if (!result.ok) {
      setErrors(result.errors);
      focusLater(result.firstError === 'weekdays' ? `${id('weekdays')}-1` : id(result.firstError));
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  return (
    <section>
      <p className="breadcrumb">
        <Link to={RULES_PATH}>Regeln</Link>
      </p>
      <h2>{heading}</h2>
      <form className="form" noValidate onSubmit={handleSubmit}>
        {error !== null && (
          <p className="alert alert-error" role="alert">
            Die Regel wurde nicht gespeichert. {requestErrorMessage(error)}
          </p>
        )}
        {original ? (
          <div className="field">
            <span className="field-label">Gruppenkurs</span>
            <p className="field-static">
              {selected?.title ?? 'Gruppenkurs'}{' '}
              <span className="muted">(nach dem Anlegen nicht änderbar)</span>
            </p>
          </div>
        ) : (
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
        )}

        <fieldset
          className="field"
          aria-describedby={errors.weekdays ? `${id('weekdays')}-error` : undefined}
        >
          <legend>Wochentage</legend>
          <div className="weekday-picker">
            {ISO_WEEKDAYS.map((day) => (
              <label key={day} className="checkbox">
                <input
                  id={`${id('weekdays')}-${String(day)}`}
                  type="checkbox"
                  checked={values.weekdays.includes(day)}
                  onChange={(event) => {
                    set(
                      'weekdays',
                      event.target.checked
                        ? [...values.weekdays, day].sort((a, b) => a - b)
                        : values.weekdays.filter((d) => d !== day),
                    );
                  }}
                />
                <span>{WEEKDAY_NAMES[day]}</span>
              </label>
            ))}
          </div>
          {errors.weekdays && (
            <p id={`${id('weekdays')}-error`} className="field-error">
              {errors.weekdays}
            </p>
          )}
        </fieldset>

        <Field
          id={id('startTime')}
          label="Beginn"
          className="field-short"
          type="time"
          step={300}
          value={values.startTime}
          error={errors.startTime}
          hint={
            selected
              ? `Dauer laut Angebot: ${String(selected.durationMinutes)} Minuten.`
              : undefined
          }
          onChange={(value) => {
            set('startTime', value);
          }}
        />
        <div className="field-row">
          <Field
            id={id('validFrom')}
            label="Gültig ab"
            type="date"
            value={values.validFrom}
            error={errors.validFrom}
            onChange={(value) => {
              set('validFrom', value);
            }}
          />
          <Field
            id={id('validUntil')}
            label={
              <>
                Gültig bis <span className="muted">(optional)</span>
              </>
            }
            type="date"
            value={values.validUntil}
            error={errors.validUntil}
            hint="Leer lassen für unbefristet."
            onChange={(value) => {
              set('validUntil', value);
            }}
          />
        </div>
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
        {original && (
          <p className="field-hint">
            Änderungen wirken auf künftige Termine ohne Buchungen; gebuchte Termine bleiben
            unverändert.
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? 'Wird gespeichert …' : original ? 'Speichern' : 'Regel anlegen'}
          </button>
          <Link className="button button-secondary" to={RULES_PATH}>
            Abbrechen
          </Link>
        </div>
      </form>
    </section>
  );
}

function RuleDeletePanel({ rule }: { rule: CourseRule }): ReactNode {
  const remove = useDeleteRule();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="panel panel-danger">
      <h3>Regel löschen</h3>
      <p className="muted">
        Künftige Termine dieser Regel ohne Buchungen werden entfernt; gebuchte Termine bleiben
        bestehen.
      </p>
      {remove.isError && (
        <p className="alert alert-error" role="alert">
          Nicht gelöscht. {requestErrorMessage(remove.error)}
        </p>
      )}
      {confirming ? (
        <div className="form-actions">
          <span className="muted">Regel wirklich löschen?</span>
          <button
            type="button"
            className="button button-danger"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(rule.id, {
                onSuccess: ({ keptWithBookings }) => {
                  const state: FlashState = {
                    flash: {
                      tone: 'success',
                      text: 'Regel gelöscht.',
                      details: [
                        {
                          title: 'Diese gebuchten Termine bleiben bestehen:',
                          items: keptWithBookings.map(formatLocalDateTime),
                        },
                      ],
                    },
                  };
                  void navigate(RULES_PATH, { state });
                },
              });
            }}
          >
            {remove.isPending ? 'Wird gelöscht …' : 'Löschen'}
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
        </div>
      ) : (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Regel löschen …
        </button>
      )}
    </div>
  );
}
