import type { Session } from '@fw-booking/shared';
import type { ReactNode } from 'react';
import { formatOccupancy, isFull } from './format.js';

/** Belegung „7 / 12 Plätze“ mit Balken; bei vollem Kurstermin „· ausgebucht“. */
export function Occupancy({
  session,
}: {
  session: Pick<Session, 'bookedCount' | 'capacity'>;
}): ReactNode {
  return (
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
  );
}
