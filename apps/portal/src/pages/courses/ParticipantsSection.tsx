import type { Booking } from '@fw-booking/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BOOKING_STATUS_LABELS, isActive, mailtoHref, telHref } from '../../bookings/format.js';
import { useSessionParticipants } from '../../bookings/queries.js';

/** Teilnehmer eines Kurstermins: aktive Buchungen mit Kontakt, die Historie eingeklappt. */
export function ParticipantsSection({ sessionId }: { sessionId: string }): ReactNode {
  const participants = useSessionParticipants(sessionId);
  const bookings = participants.data?.bookings ?? [];
  const active = bookings.filter(isActive);
  const history = bookings.filter((booking) => !isActive(booking));

  return (
    <section className="panel" aria-labelledby="participants-heading">
      <h3 id="participants-heading">Teilnehmer ({participants.isSuccess ? active.length : '…'})</h3>
      {participants.isPending && <p role="status">Teilnehmer werden geladen …</p>}
      {participants.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Teilnehmerliste konnte nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void participants.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {participants.isSuccess && active.length === 0 && (
        <p className="muted">Keine bestätigten Buchungen.</p>
      )}
      {active.length > 0 && <ParticipantList bookings={active} label="Bestätigte Teilnehmer" />}
      {history.length > 0 && (
        <details className="history">
          <summary>Storniert, umgebucht oder abgesagt ({history.length})</summary>
          <ParticipantList bookings={history} label="Frühere Buchungen" />
        </details>
      )}
    </section>
  );
}

function ParticipantList({ bookings, label }: { bookings: Booking[]; label: string }): ReactNode {
  return (
    <ol className="participants" aria-label={label}>
      {bookings.map((booking) => (
        <li key={booking.id}>
          <Link to={`/buchungen/${booking.id}`} className="participant-name">
            {booking.participant.name}
          </Link>
          {!isActive(booking) && (
            <span className="badge badge-closed">{BOOKING_STATUS_LABELS[booking.status]}</span>
          )}
          <span className="participant-contact">
            <a href={mailtoHref(booking.participant.email)}>{booking.participant.email}</a>
            <a href={telHref(booking.participant.phone)}>{booking.participant.phone}</a>
          </span>
        </li>
      ))}
    </ol>
  );
}
