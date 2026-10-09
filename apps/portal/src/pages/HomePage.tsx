// Startansicht (auch Start der installierten App): Termine eines Tages mit Belegung, Blättern
// zu anderen Tagen, „Als Nächstes“ und Stand der Daten. Teilnehmernamen erst in der Detailansicht.
import { formatTimeRange, utcToLocal } from '@fw-booking/shared';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, formatLocalDate, todayIn } from '../availability/time.js';
import { useBookings } from '../bookings/queries.js';
import { SESSION_STATUS_LABELS } from '../courses/format.js';
import { Occupancy } from '../courses/Occupancy.js';
import { useSessions } from '../courses/queries.js';
import {
  NEXT_SEARCH_DAYS,
  buildAgenda,
  dayFromParam,
  dayHeading,
  formatClock,
  hasRemaining,
  nextItem,
  nextSearchRange,
  timingOf,
} from '../home/agenda.js';
import type { AgendaItem, ItemTiming } from '../home/agenda.js';
import { useNow } from '../home/useNow.js';
import { useTimeZone } from '../installation.js';
import { NOTIFICATIONS_PATH } from '../layout/navigation.js';
import { usePageTitle } from '../layout/usePageTitle.js';
import { useFailedNotifications } from '../notifications/queries.js';
import { useServices } from '../services/queries.js';

/** Automatische Aktualisierung bei geöffneter App; zusätzlich beim Zurückkehren in die App. */
export const REFRESH_MS = 5 * 60_000;
const REFRESH = { refetchInterval: REFRESH_MS };

const TIMING_LABELS: Record<Exclude<ItemTiming, 'upcoming'>, string> = {
  running: 'Läuft gerade',
  past: 'Vorbei',
};

export function HomePage(): ReactNode {
  usePageTitle('Übersicht');
  const failedCount = useFailedNotifications().data?.total ?? 0;
  const { timeZone, ready } = useTimeZone();
  return (
    <section>
      <h1>Übersicht</h1>
      {failedCount > 0 && (
        <p className="alert alert-warning">
          {failedCount === 1
            ? '1 E-Mail an Teilnehmer konnte nicht zugestellt werden. '
            : `${String(failedCount)} E-Mails an Teilnehmer konnten nicht zugestellt werden. `}
          <Link to={NOTIFICATIONS_PATH}>Benachrichtigungen ansehen</Link>
        </p>
      )}
      {ready ? <Agenda timeZone={timeZone} /> : <p role="status">Wird geladen …</p>}
    </section>
  );
}

function useServiceTitles(): Map<string, string> {
  const services = useServices();
  return new Map((services.data ?? []).map((service) => [service.id, service.title]));
}

function Agenda({ timeZone }: { timeZone: string }): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNow();
  const today = todayIn(timeZone, new Date(now));
  const day = dayFromParam(searchParams.get('tag'), today);
  const sessions = useSessions(day, day, REFRESH);
  const bookings = useBookings({ from: day, to: day }, '', false, REFRESH);
  const titles = useServiceTitles();

  function goTo(date: string): void {
    setSearchParams(date === today ? {} : { tag: date }, { replace: true });
  }

  const loaded = sessions.data !== undefined && bookings.data !== undefined;
  const items = loaded ? buildAgenda(sessions.data, bookings.data) : [];
  const fetching = sessions.isFetching || bookings.isFetching;
  const loadFailed = !loaded && (sessions.isError || bookings.isError);
  const refreshFailed = loaded && (sessions.isError || bookings.isError);
  // Stand der ältesten der beiden Abfragen: beide zusammen ergeben den Tag.
  const updatedAt = loaded ? Math.min(sessions.dataUpdatedAt, bookings.dataUpdatedAt) : 0;

  function refresh(): void {
    void sessions.refetch();
    void bookings.refetch();
  }

  return (
    <>
      <div className="toolbar">
        <div className="week-nav day-nav">
          <button
            type="button"
            className="button button-secondary button-icon"
            aria-label="Vorheriger Tag"
            onClick={() => {
              goTo(addDays(day, -1));
            }}
          >
            ←
          </button>
          <h2 className="week-title" aria-live="polite">
            {dayHeading(day, today)}
          </h2>
          <button
            type="button"
            className="button button-secondary button-icon"
            aria-label="Nächster Tag"
            onClick={() => {
              goTo(addDays(day, 1));
            }}
          >
            →
          </button>
          {day !== today && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                goTo(today);
              }}
            >
              Heute
            </button>
          )}
        </div>
        <div className="toolbar-actions refresh">
          {loaded && (
            <span className="muted refresh-time">
              Stand: {formatClock(updatedAt, timeZone)} Uhr
            </span>
          )}
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={fetching}
            onClick={refresh}
          >
            {fetching && loaded ? 'Wird aktualisiert …' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      {refreshFailed && (
        <p className="alert alert-warning" role="alert">
          Aktualisieren fehlgeschlagen. Angezeigt wird der Stand von{' '}
          {formatClock(updatedAt, timeZone)} Uhr.
        </p>
      )}
      {!loaded && !loadFailed && <p role="status">Termine werden geladen …</p>}
      {loadFailed && (
        <div className="alert alert-error" role="alert">
          <p>Die Termine konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={refresh}>
            Erneut versuchen
          </button>
        </div>
      )}
      {loaded && items.length === 0 && (
        <div className="empty">
          <p>Keine Termine an diesem Tag.</p>
        </div>
      )}
      {loaded && items.length > 0 && (
        <ul className="item-list" aria-label="Termine">
          {items.map((item) => (
            <AgendaEntry key={item.id} item={item} titles={titles} now={now} />
          ))}
        </ul>
      )}
      {loaded && !hasRemaining(items, now) && (
        <NextAppointment day={day} today={today} now={now} titles={titles} onShowDay={goTo} />
      )}
    </>
  );
}

function NextAppointment({
  day,
  today,
  now,
  titles,
  onShowDay,
}: {
  day: string;
  today: string;
  now: number;
  titles: Map<string, string>;
  onShowDay: (date: string) => void;
}): ReactNode {
  const range = nextSearchRange(day, today);
  const sessions = useSessions(range.from, range.to, REFRESH);
  const bookings = useBookings(range, '', false, REFRESH);
  const loaded = sessions.data !== undefined && bookings.data !== undefined;
  const next = loaded ? nextItem(buildAgenda(sessions.data, bookings.data), now) : null;
  const nextDay = next ? utcToLocal(next.startsAt, entryTimeZone(next)).date : null;

  return (
    <section className="next-up" aria-labelledby="next-up-heading">
      <h2 id="next-up-heading" className="day-heading">
        Als Nächstes
      </h2>
      {!loaded && (sessions.isError || bookings.isError) && (
        <p className="muted">Der nächste Termin konnte nicht geladen werden.</p>
      )}
      {!loaded && !sessions.isError && !bookings.isError && (
        <p role="status">Nächster Termin wird gesucht …</p>
      )}
      {loaded && !next && (
        <p className="muted">
          In den nächsten {String(NEXT_SEARCH_DAYS)} Tagen ist kein Termin geplant.
        </p>
      )}
      {next && nextDay && (
        <>
          <ul className="item-list">
            <AgendaEntry item={next} titles={titles} now={now} date={nextDay} />
          </ul>
          <button
            type="button"
            className="button button-secondary button-small next-up-day"
            onClick={() => {
              onShowDay(nextDay);
            }}
          >
            {`Tag anzeigen (${formatLocalDate(nextDay)})`}
          </button>
        </>
      )}
    </section>
  );
}

function entryTimeZone(item: AgendaItem): string {
  return item.kind === 'session' ? item.session.timeZone : item.booking.timeZone;
}

/** Ein Termin ohne Teilnehmernamen; der Link führt zur Detailansicht mit den Namen. */
function AgendaEntry({
  item,
  titles,
  now,
  date,
}: {
  item: AgendaItem;
  titles: Map<string, string>;
  now: number;
  /** Datum voranstellen (bei „Als Nächstes“). */
  date?: string;
}): ReactNode {
  const timing = timingOf(item, now);
  const time = `${formatTimeRange(item.startsAt, item.endsAt, entryTimeZone(item))} Uhr`;
  const when = date ? `${formatLocalDate(date)}, ${time}` : time;
  const cancelled = item.kind === 'session' && item.session.status === 'cancelled';
  const className = [
    'item',
    cancelled ? 'item-inactive' : '',
    timing === 'past' && !cancelled ? 'item-past' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (item.kind === 'session') {
    const { session } = item;
    return (
      <li className={className}>
        <div className="item-main">
          <Link className="item-title" to={`/kurstermine/${session.id}`}>
            {when} · {titles.get(session.serviceId) ?? 'Gruppenkurs'}
          </Link>
          <span className="item-meta">
            <span>Kurs</span>
            {session.location && <span>{session.location}</span>}
            {session.status !== 'scheduled' && (
              <span className={cancelled ? 'badge badge-closed' : 'badge'}>
                {SESSION_STATUS_LABELS[session.status]}
              </span>
            )}
            {!cancelled && timing !== 'upcoming' && (
              <span className="badge">{TIMING_LABELS[timing]}</span>
            )}
          </span>
        </div>
        {!cancelled && <Occupancy session={session} />}
      </li>
    );
  }

  const { booking } = item;
  return (
    <li className={className}>
      <div className="item-main">
        <Link className="item-title" to={`/buchungen/${booking.id}`}>
          {when} · {titles.get(booking.serviceId) ?? 'Einzeltermin'}
        </Link>
        <span className="item-meta">
          <span>Einzeltermin</span>
          {timing !== 'upcoming' && <span className="badge">{TIMING_LABELS[timing]}</span>}
        </span>
      </div>
    </li>
  );
}
