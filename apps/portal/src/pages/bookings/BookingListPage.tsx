import { formatTimeRange, utcToLocal } from '@fw-booking/shared';
import type { Booking } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatLocalDate, todayIn } from '../../availability/time.js';
import { BOOKING_STATUS_LABELS, isActive } from '../../bookings/format.js';
import { useBookings } from '../../bookings/queries.js';
import {
  RANGE_ERROR_MESSAGES,
  RANGE_PRESETS,
  checkRange,
  rangeFromParams,
} from '../../bookings/range.js';
import type { DateRange } from '../../bookings/range.js';
import { useTimeZone } from '../../installation.js';
import { Field } from '../../layout/Field.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { SERVICE_TYPE_LABELS } from '../../services/format.js';
import { useServices } from '../../services/queries.js';

export function BookingListPage(): ReactNode {
  usePageTitle('Buchungen');
  const { timeZone, ready } = useTimeZone();
  return (
    <section>
      <h1>Buchungen</h1>
      {ready ? <Bookings timeZone={timeZone} /> : <p role="status">Wird geladen …</p>}
    </section>
  );
}

function Bookings({ timeZone }: { timeZone: string }): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayIn(timeZone);
  const range = rangeFromParams(searchParams, today);
  const serviceId = searchParams.get('angebot') ?? '';
  const all = searchParams.get('alle') === '1';
  const bookings = useBookings(range, serviceId, all);
  const services = useServices();
  const titles = new Map((services.data ?? []).map((s) => [s.id, s.title]));

  function update(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  const list = bookings.data ?? [];
  const byDate = new Map<string, Booking[]>();
  for (const booking of list) {
    const date = utcToLocal(booking.startsAt, booking.timeZone).date;
    byDate.set(date, [...(byDate.get(date) ?? []), booking]);
  }
  const active = list.filter(isActive).length;

  return (
    <>
      <RangeForm
        // Neu aufbauen, wenn sich der Zeitraum von außen ändert (Schnellauswahl, Zurück).
        key={`${range.from}|${range.to}`}
        range={range}
        onApply={(next) => {
          update({ von: next.from, bis: next.to });
        }}
      />
      <div className="toolbar">
        <div className="preset-buttons" role="group" aria-label="Schnellauswahl Zeitraum">
          {RANGE_PRESETS.map((preset) => {
            const presetRange = preset.range(today);
            const current = presetRange.from === range.from && presetRange.to === range.to;
            return (
              <button
                key={preset.key}
                type="button"
                className="button button-secondary button-small"
                aria-pressed={current}
                onClick={() => {
                  update({ von: presetRange.from, bis: presetRange.to });
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="toolbar-actions">
          <label className="inline-field">
            <span>Angebot</span>
            <select
              value={serviceId}
              onChange={(event) => {
                update({ angebot: event.target.value });
              }}
            >
              <option value="">Alle Angebote</option>
              {(services.data ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.title}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox toolbar-checkbox">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => {
                update({ alle: event.target.checked ? '1' : null });
              }}
            />
            <span>Auch stornierte und abgesagte anzeigen</span>
          </label>
        </div>
      </div>

      {bookings.isPending && <p role="status">Buchungen werden geladen …</p>}
      {bookings.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Buchungen konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void bookings.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {bookings.isSuccess && (
        <p className="muted" role="status">
          {formatLocalDate(range.from)} – {formatLocalDate(range.to)}:{' '}
          {active === 1 ? '1 bestätigte Buchung' : `${String(active)} bestätigte Buchungen`}
          {all && list.length > active && `, ${String(list.length - active)} weitere`}
        </p>
      )}
      {bookings.isSuccess && list.length === 0 && (
        <div className="empty">
          <p>Keine Buchungen in diesem Zeitraum.</p>
        </div>
      )}
      {bookings.isSuccess && list.length > 0 && (
        <div className="day-groups">
          {[...byDate.entries()].map(([date, dayBookings]) => (
            <section key={date} aria-labelledby={`bookings-${date}`} className="day-group">
              <h2 id={`bookings-${date}`} className="day-heading">
                {formatLocalDate(date)}
                {date === today && <span className="badge">Heute</span>}
              </h2>
              <ul className="item-list">
                {dayBookings.map((booking) => (
                  <li
                    key={booking.id}
                    className={isActive(booking) ? 'item' : 'item item-inactive'}
                  >
                    <div className="item-main">
                      <Link className="item-title" to={`/buchungen/${booking.id}`}>
                        {formatTimeRange(booking.startsAt, booking.endsAt, booking.timeZone)} Uhr ·{' '}
                        {booking.participant.name}
                      </Link>
                      <span className="item-meta">
                        <span>
                          {titles.get(booking.serviceId) ?? SERVICE_TYPE_LABELS[booking.type]}
                        </span>
                        {!isActive(booking) && (
                          <span className="badge badge-closed">
                            {BOOKING_STATUS_LABELS[booking.status]}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function RangeForm({
  range,
  onApply,
}: {
  range: DateRange;
  onApply: (range: DateRange) => void;
}): ReactNode {
  const base = useId();
  const [values, setValues] = useState(range);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const problem = checkRange(values);
    if (problem) {
      setError(RANGE_ERROR_MESSAGES[problem]);
      return;
    }
    setError(null);
    onApply(values);
  }

  return (
    <form className="range-form" noValidate onSubmit={handleSubmit} aria-label="Zeitraum">
      <Field
        id={`${base}-from`}
        label="Von"
        type="date"
        value={values.from}
        onChange={(value) => {
          setValues((current) => ({ ...current, from: value }));
        }}
      />
      <Field
        id={`${base}-to`}
        label="Bis"
        type="date"
        value={values.to}
        onChange={(value) => {
          setValues((current) => ({ ...current, to: value }));
        }}
      />
      <button type="submit" className="button button-secondary">
        Anzeigen
      </button>
      {error && (
        <p className="field-error range-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
