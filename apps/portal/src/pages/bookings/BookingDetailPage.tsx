import { formatDate, formatDateTime, formatTimeRange, utcToLocal } from '@fw-booking/shared';
import type { Booking } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { isApiError } from '../../api/client.js';
import { requestErrorMessage } from '../../api/messages.js';
import { BOOKING_STATUS_LABELS, isActive, mailtoHref, telHref } from '../../bookings/format.js';
import { useBooking, useCancelBooking } from '../../bookings/queries.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { SERVICE_TYPE_LABELS } from '../../services/format.js';
import { useServices } from '../../services/queries.js';

const OBJECT_ID = /^[0-9a-f]{24}$/;

export function BookingDetailPage(): ReactNode {
  const { bookingId = '' } = useParams();
  if (!OBJECT_ID.test(bookingId)) return <BookingNotFound />;
  return <BookingLoader id={bookingId} />;
}

function BookingNotFound(): ReactNode {
  usePageTitle('Buchung nicht gefunden');
  return (
    <section>
      <h1>Buchung nicht gefunden</h1>
      <p>
        <Link to="/buchungen">Zur Buchungsübersicht</Link>
      </p>
    </section>
  );
}

function BookingLoader({ id }: { id: string }): ReactNode {
  // Bewusst ohne Teilnehmernamen im Fenstertitel (Verlauf, Tab-Leisten, geteilter Bildschirm).
  usePageTitle('Buchung');
  const booking = useBooking(id);
  if (booking.isPending) return <p role="status">Buchung wird geladen …</p>;
  if (booking.isError) {
    if (isApiError(booking.error, 404) || isApiError(booking.error, 400)) {
      return <BookingNotFound />;
    }
    return (
      <div className="alert alert-error" role="alert">
        <p>Die Buchung konnte nicht geladen werden.</p>
        <button type="button" className="button" onClick={() => void booking.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  return <BookingDetail booking={booking.data} />;
}

function BookingDetail({ booking }: { booking: Booking }): ReactNode {
  const services = useServices();
  const title =
    services.data?.find((s) => s.id === booking.serviceId)?.title ??
    SERVICE_TYPE_LABELS[booking.type];
  const [openedAt] = useState(() => Date.now());
  const ended = Date.parse(booking.endsAt) <= openedAt;
  const [notice, setNotice] = useState<string | null>(null);
  const date = utcToLocal(booking.startsAt, booking.timeZone).date;
  const { participant } = booking;

  return (
    <section>
      <p className="breadcrumb">
        <Link to={`/buchungen?von=${date}&bis=${date}&alle=1`}>Buchungen</Link>
      </p>
      <h1>{participant.name}</h1>
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>Termin</dt>
          <dd>
            {formatDate(booking.startsAt, booking.timeZone)},{' '}
            {formatTimeRange(booking.startsAt, booking.endsAt, booking.timeZone)} Uhr
          </dd>
        </div>
        <div>
          <dt>Angebot</dt>
          <dd>
            {booking.sessionId ? (
              <Link to={`/kurstermine/${booking.sessionId}`}>{title}</Link>
            ) : (
              title
            )}{' '}
            <span className="muted">({SERVICE_TYPE_LABELS[booking.type]})</span>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {BOOKING_STATUS_LABELS[booking.status]}
            {ended && isActive(booking) && ' (vorbei)'}
          </dd>
        </div>
        <div>
          <dt>E-Mail</dt>
          <dd>
            <a href={mailtoHref(participant.email)}>{participant.email}</a>
          </dd>
        </div>
        <div>
          <dt>Telefon</dt>
          <dd>
            <a href={telHref(participant.phone)}>{participant.phone}</a>
          </dd>
        </div>
        <div>
          <dt>Gebucht am</dt>
          <dd>{formatDateTime(booking.createdAt, booking.timeZone)} Uhr</dd>
        </div>
        {booking.ownerCancellationReason && (
          <div>
            <dt>Absagegrund</dt>
            <dd>{booking.ownerCancellationReason}</dd>
          </div>
        )}
        {booking.rebookedToBookingId && (
          <div>
            <dt>Umgebucht auf</dt>
            <dd>
              <Link to={`/buchungen/${booking.rebookedToBookingId}`}>Neue Buchung ansehen</Link>
            </dd>
          </div>
        )}
      </dl>
      {isActive(booking) && !ended && (
        <BookingCancelPanel booking={booking} onCancelled={setNotice} />
      )}
    </section>
  );
}

function BookingCancelPanel({
  booking,
  onCancelled,
}: {
  booking: Booking;
  onCancelled: (text: string) => void;
}): ReactNode {
  const base = useId();
  const cancel = useCancelBooking();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="panel panel-danger">
      <h2>Buchung absagen</h2>
      {!open ? (
        <>
          <p className="muted">
            Sagt diese Buchung ab und gibt den Platz bzw. die Zeit wieder frei. Der Teilnehmer
            erhält eine E-Mail.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            Buchung absagen …
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
              { id: booking.id, reason: trimmed === '' ? null : trimmed },
              {
                onSuccess: ({ alreadyCancelled }) => {
                  onCancelled(
                    alreadyCancelled
                      ? 'Die Buchung war bereits abgesagt.'
                      : 'Buchung abgesagt. Der Teilnehmer wird per E-Mail informiert.',
                  );
                },
              },
            );
          }}
        >
          <p className="alert alert-warning">
            {booking.participant.name} erhält eine Absage per E-Mail. Die Absage kann nicht
            rückgängig gemacht werden.
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
              Wird in der E-Mail an den Teilnehmer genannt.
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
