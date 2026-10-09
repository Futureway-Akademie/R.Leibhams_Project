import { formatTimeRange } from '@fw-booking/shared';
import type { Service, Session } from '@fw-booking/shared';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, formatLocalDate, todayIn } from '../../availability/time.js';
import {
  SESSION_STATUS_LABELS,
  formatOccupancy,
  isFull,
  sessionLocalStart,
} from '../../courses/format.js';
import { useSessions } from '../../courses/queries.js';
import { formatWeek, weekDates, weekFromParam } from '../../courses/week.js';
import { useTimeZone } from '../../installation.js';
import { FlashMessage, useFlash } from '../../layout/flash.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { useServices } from '../../services/queries.js';

export function SessionListPage(): ReactNode {
  usePageTitle('Kurstermine');
  const { timeZone, ready } = useTimeZone();
  if (!ready) return <p role="status">Kurstermine werden geladen …</p>;
  return <SessionWeek timeZone={timeZone} />;
}

function SessionWeek({ timeZone }: { timeZone: string }): ReactNode {
  const flash = useFlash();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayIn(timeZone);
  const monday = weekFromParam(searchParams.get('woche'), today);
  const sunday = addDays(monday, 6);
  const serviceFilter = searchParams.get('angebot') ?? '';
  const sessions = useSessions(monday, sunday);
  const services = useServices();

  const groupServices = (services.data ?? []).filter(
    (s): s is Extract<Service, { type: 'group' }> => s.type === 'group',
  );
  const titles = new Map((services.data ?? []).map((s) => [s.id, s.title]));

  function setParam(key: 'woche' | 'angebot', value: string | null): void {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: key === 'angebot' });
  }

  const visible = (sessions.data ?? []).filter(
    (session) => serviceFilter === '' || session.serviceId === serviceFilter,
  );
  const byDate = new Map<string, Session[]>();
  for (const session of visible) {
    const date = sessionLocalStart(session).date;
    byDate.set(date, [...(byDate.get(date) ?? []), session]);
  }

  return (
    <section>
      <FlashMessage flash={flash} />
      <div className="toolbar">
        <div className="week-nav">
          <button
            type="button"
            className="button button-secondary button-icon"
            aria-label="Vorherige Woche"
            onClick={() => {
              setParam('woche', addDays(monday, -7));
            }}
          >
            ←
          </button>
          <h2 className="week-title" aria-live="polite">
            {formatWeek(monday)}
          </h2>
          <button
            type="button"
            className="button button-secondary button-icon"
            aria-label="Nächste Woche"
            onClick={() => {
              setParam('woche', addDays(monday, 7));
            }}
          >
            →
          </button>
          {monday !== weekFromParam(null, today) && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                setParam('woche', null);
              }}
            >
              Heute
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          <label className="inline-field">
            <span>Angebot</span>
            <select
              value={serviceFilter}
              onChange={(event) => {
                setParam('angebot', event.target.value);
              }}
            >
              <option value="">Alle Gruppenkurse</option>
              {groupServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.title}
                </option>
              ))}
            </select>
          </label>
          <Link className="button button-primary" to="/kurstermine/neu">
            Neuer Kurstermin
          </Link>
        </div>
      </div>

      {sessions.isPending && <p role="status">Kurstermine werden geladen …</p>}
      {sessions.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Kurstermine konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void sessions.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {sessions.isSuccess && visible.length === 0 && (
        <div className="empty">
          <p>Keine Kurstermine in dieser Woche.</p>
          <p className="muted">
            Lege einzelne Kurstermine an oder erzeuge sie über eine{' '}
            <Link to="/kurstermine/regeln">wiederkehrende Regel</Link>.
          </p>
        </div>
      )}
      {sessions.isSuccess && visible.length > 0 && (
        <div className="day-groups">
          {weekDates(monday)
            .filter((date) => byDate.has(date))
            .map((date) => (
              <section key={date} aria-labelledby={`day-${date}`} className="day-group">
                <h3 id={`day-${date}`}>
                  {formatLocalDate(date)}
                  {date === today && <span className="badge">Heute</span>}
                </h3>
                <ul className="item-list">
                  {(byDate.get(date) ?? []).map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      title={titles.get(session.serviceId) ?? 'Gruppenkurs'}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </section>
  );
}

function SessionItem({ session, title }: { session: Session; title: string }): ReactNode {
  const cancelled = session.status === 'cancelled';
  return (
    <li className={cancelled ? 'item item-inactive' : 'item'}>
      <div className="item-main">
        <Link className="item-title" to={`/kurstermine/${session.id}`}>
          {formatTimeRange(session.startsAt, session.endsAt, session.timeZone)} Uhr · {title}
        </Link>
        <span className="item-meta">
          {session.location && <span>{session.location}</span>}
          {session.status !== 'scheduled' && (
            <span className={cancelled ? 'badge badge-closed' : 'badge'}>
              {SESSION_STATUS_LABELS[session.status]}
            </span>
          )}
          {session.ruleId && <span className="badge">Regel</span>}
        </span>
      </div>
      {!cancelled && (
        <div className="occupancy">
          <span className={isFull(session) ? 'occupancy-text occupancy-full' : 'occupancy-text'}>
            {formatOccupancy(session)}
            {isFull(session) && ' · ausgebucht'}
          </span>
          {/* Natives Element statt Inline-Style (verträglich mit strikter Content-Security-Policy). */}
          <progress
            className="occupancy-bar"
            max={session.capacity}
            value={session.bookedCount}
            aria-hidden="true"
          />
        </div>
      )}
    </li>
  );
}
