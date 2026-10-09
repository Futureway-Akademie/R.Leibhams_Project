import { formatDate, formatTimeRange } from '@fw-booking/shared';
import type { Session } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/client.js';
import { requestErrorMessage } from '../../api/messages.js';
import {
  SESSION_STATUS_LABELS,
  formatOccupancy,
  isFull,
  sessionLocalStart,
} from '../../courses/format.js';
import {
  useCancelSession,
  useDeleteSession,
  useSession,
  useUpdateSession,
} from '../../courses/queries.js';
import { sessionToInput, validateSessionChange } from '../../courses/session-form.js';
import type { SessionErrors, SessionField, SessionInput } from '../../courses/session-form.js';
import { Field, focusLater } from '../../layout/Field.js';
import { ParticipantsSection } from './ParticipantsSection.js';
import type { FlashState } from '../../layout/flash.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { useServices } from '../../services/queries.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;

export function SessionDetailPage(): ReactNode {
  const { sessionId = '' } = useParams();
  if (!OBJECT_ID.test(sessionId)) return <SessionNotFound />;
  return <SessionLoader id={sessionId} />;
}

function SessionNotFound(): ReactNode {
  usePageTitle('Kurstermin nicht gefunden');
  return (
    <section>
      <h2>Kurstermin nicht gefunden</h2>
      <p>
        <Link to="/kurstermine">Zu den Kursterminen</Link>
      </p>
    </section>
  );
}

function SessionLoader({ id }: { id: string }): ReactNode {
  const session = useSession(id);
  const services = useServices();
  const title = services.data?.find((s) => s.id === session.data?.serviceId)?.title ?? 'Kurstermin';
  usePageTitle(session.data ? title : 'Kurstermin');

  if (session.isPending) return <p role="status">Kurstermin wird geladen …</p>;
  if (session.isError) {
    if (isApiError(session.error, 404) || isApiError(session.error, 400)) {
      return <SessionNotFound />;
    }
    return (
      <div className="alert alert-error" role="alert">
        <p>Der Kurstermin konnte nicht geladen werden.</p>
        <button type="button" className="button" onClick={() => void session.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  return <SessionDetail key={session.data.id} session={session.data} title={title} />;
}

function SessionDetail({ session, title }: { session: Session; title: string }): ReactNode {
  const local = sessionLocalStart(session);
  // Zeitpunkt beim Öffnen der Seite; ein Termin, der währenddessen endet, meldet die API.
  const [openedAt] = useState(() => Date.now());
  const ended = Date.parse(session.endsAt) <= openedAt;
  const [notice, setNotice] = useState<string | null>(null);
  const cancelled = session.status === 'cancelled';
  const weekLink = `/kurstermine?woche=${local.date}`;

  return (
    <section>
      <p className="breadcrumb">
        <Link to={weekLink}>Termine</Link>
      </p>
      <h2>{title}</h2>
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>Termin</dt>
          <dd>
            {formatDate(session.startsAt, session.timeZone)},{' '}
            {formatTimeRange(session.startsAt, session.endsAt, session.timeZone)} Uhr
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {SESSION_STATUS_LABELS[session.status]}
            {ended && !cancelled && ' (vorbei)'}
          </dd>
        </div>
        <div>
          <dt>Belegung</dt>
          <dd className={isFull(session) ? 'occupancy-full' : undefined}>
            {formatOccupancy(session)}
            {isFull(session) && ' · ausgebucht'}
          </dd>
        </div>
        {session.location && (
          <div>
            <dt>Ort</dt>
            <dd>{session.location}</dd>
          </div>
        )}
        <div>
          <dt>Herkunft</dt>
          <dd>{session.ruleId ? 'Aus wiederkehrender Regel' : 'Einzeln angelegt'}</dd>
        </div>
        {cancelled && session.cancellationReason && (
          <div>
            <dt>Absagegrund</dt>
            <dd>{session.cancellationReason}</dd>
          </div>
        )}
      </dl>

      <ParticipantsSection sessionId={session.id} />
      {cancelled && <p className="muted">Abgesagte Kurstermine können nicht geändert werden.</p>}
      {ended && !cancelled && (
        <p className="muted">Der Termin ist vorbei und kann nicht mehr geändert werden.</p>
      )}
      {!cancelled && !ended && (
        <>
          <SessionEditForm session={session} />
          <BlockToggle session={session} />
          <CancelPanel session={session} onCancelled={setNotice} />
          {session.bookedCount === 0 && <DeletePanel session={session} weekLink={weekLink} />}
        </>
      )}
    </section>
  );
}

function SessionEditForm({ session }: { session: Session }): ReactNode {
  const base = useId();
  const update = useUpdateSession();
  const [values, setValues] = useState<SessionInput>(() => sessionToInput(session));
  const [errors, setErrors] = useState<SessionErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const id = (field: SessionField): string => `${base}-${field}`;
  const timeLocked = session.bookedCount > 0;

  function set(field: SessionField, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setSaved(null);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (update.isPending) return;
    const result = validateSessionChange(session, values);
    if (!result.ok) {
      setErrors(result.errors);
      focusLater(id(result.firstError));
      return;
    }
    setErrors({});
    if (!result.patch) {
      setSaved('Keine Änderungen.');
      return;
    }
    update.mutate(
      { id: session.id, patch: result.patch },
      {
        onSuccess: (next) => {
          setValues(sessionToInput(next));
          setSaved('Änderungen gespeichert.');
        },
      },
    );
  }

  return (
    <form
      className="form panel"
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={`${base}-title`}
    >
      <h3 id={`${base}-title`}>Bearbeiten</h3>
      {saved && (
        <p className="alert alert-success" role="status">
          {saved}
        </p>
      )}
      {update.isError && (
        <p className="alert alert-error" role="alert">
          Nicht gespeichert. {requestErrorMessage(update.error)}
        </p>
      )}
      <div className="field-row">
        <Field
          id={id('date')}
          label="Datum"
          type="date"
          value={values.date}
          error={errors.date}
          disabled={timeLocked}
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
          disabled={timeLocked}
          onChange={(value) => {
            set('time', value);
          }}
        />
      </div>
      {timeLocked && (
        <p className="field-hint">
          Termine mit Buchungen können nicht verschoben werden; bitte absagen und neu anlegen.
        </p>
      )}
      <Field
        id={id('capacity')}
        label="Plätze"
        className="field-short"
        type="number"
        inputMode="numeric"
        min={Math.max(2, session.bookedCount)}
        value={values.capacity}
        error={errors.capacity}
        hint={
          session.bookedCount > 0
            ? `Nicht weniger als die ${String(session.bookedCount)} gebuchten Plätze.`
            : undefined
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
        <button type="submit" className="button button-primary" disabled={update.isPending}>
          {update.isPending ? 'Wird gespeichert …' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}

function BlockToggle({ session }: { session: Session }): ReactNode {
  const update = useUpdateSession();
  const blocked = session.status === 'blocked';
  return (
    <div className="panel">
      <h3>{blocked ? 'Gesperrt' : 'Sperren'}</h3>
      <p className="muted">
        {blocked
          ? 'Der Termin ist für neue Buchungen gesperrt und erscheint nicht im Widget. Bestehende Buchungen bleiben gültig.'
          : 'Ein gesperrter Termin nimmt keine neuen Buchungen an und erscheint nicht im Widget. Bestehende Buchungen bleiben gültig.'}
      </p>
      {update.isError && (
        <p className="alert alert-error" role="alert">
          Nicht geändert. {requestErrorMessage(update.error)}
        </p>
      )}
      <button
        type="button"
        className="button button-secondary"
        disabled={update.isPending}
        onClick={() => {
          update.mutate({ id: session.id, patch: { status: blocked ? 'scheduled' : 'blocked' } });
        }}
      >
        {blocked ? 'Sperre aufheben' : 'Für neue Buchungen sperren'}
      </button>
    </div>
  );
}

function CancelPanel({
  session,
  onCancelled,
}: {
  session: Session;
  onCancelled: (text: string) => void;
}): ReactNode {
  const base = useId();
  const cancel = useCancelSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const affected = session.bookedCount;

  return (
    <div className="panel panel-danger">
      <h3>Absagen</h3>
      {!open ? (
        <>
          <p className="muted">
            Sagt den Termin samt aller Buchungen ab. Teilnehmer erhalten eine E-Mail.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            Kurstermin absagen …
          </button>
        </>
      ) : (
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (cancel.isPending) return;
            const trimmed = reason.trim();
            cancel.mutate(
              { id: session.id, reason: trimmed === '' ? null : trimmed },
              {
                onSuccess: ({ cancelledBookings, alreadyCancelled }) => {
                  onCancelled(
                    alreadyCancelled
                      ? 'Der Kurstermin war bereits abgesagt.'
                      : cancelledBookings === 0
                        ? 'Kurstermin abgesagt.'
                        : `Kurstermin abgesagt. ${String(cancelledBookings)} ${cancelledBookings === 1 ? 'Buchung wurde' : 'Buchungen wurden'} abgesagt; die Teilnehmer werden per E-Mail informiert.`,
                  );
                },
              },
            );
          }}
        >
          <p className="alert alert-warning">
            {affected === 0
              ? 'Für diesen Termin gibt es keine Buchungen.'
              : `${String(affected)} ${affected === 1 ? 'bestätigte Buchung wird' : 'bestätigte Buchungen werden'} abgesagt. Die Teilnehmer erhalten eine E-Mail.`}{' '}
            Die Absage kann nicht rückgängig gemacht werden.
          </p>
          {cancel.isError && (
            <p className="alert alert-error" role="alert">
              Nicht abgesagt. {requestErrorMessage(cancel.error)}
            </p>
          )}
          <div className="field">
            <label htmlFor={`${base}-reason`}>
              Begründung <span className="muted">(optional)</span>
            </label>
            <textarea
              id={`${base}-reason`}
              rows={3}
              maxLength={500}
              value={reason}
              aria-describedby={`${base}-reason-hint`}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p id={`${base}-reason-hint`} className="field-hint">
              Wird in der E-Mail an die Teilnehmer genannt.
            </p>
          </div>
          <div className="form-actions">
            <button type="submit" className="button button-danger" disabled={cancel.isPending}>
              {cancel.isPending ? 'Wird abgesagt …' : 'Verbindlich absagen'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={cancel.isPending}
              onClick={() => {
                setOpen(false);
                cancel.reset();
              }}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DeletePanel({ session, weekLink }: { session: Session; weekLink: string }): ReactNode {
  const remove = useDeleteSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="panel">
      <h3>Löschen</h3>
      <p className="muted">
        Nur möglich, solange es nie eine Buchung gab.
        {session.ruleId && ' Aus einer Regel erzeugte Termine werden dabei nicht neu angelegt.'}
      </p>
      {remove.isError && (
        <p className="alert alert-error" role="alert">
          Nicht gelöscht.{' '}
          {isApiError(remove.error, 409)
            ? 'Für diesen Termin gab es bereits Buchungen; bitte stattdessen absagen.'
            : requestErrorMessage(remove.error)}
        </p>
      )}
      {confirming ? (
        <div className="form-actions">
          <span className="muted">Kurstermin wirklich löschen?</span>
          <button
            type="button"
            className="button button-danger"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(session.id, {
                onSuccess: () => {
                  const state: FlashState = {
                    flash: { tone: 'success', text: 'Kurstermin gelöscht.' },
                  };
                  void navigate(weekLink, { state });
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
          Kurstermin löschen …
        </button>
      )}
    </div>
  );
}
