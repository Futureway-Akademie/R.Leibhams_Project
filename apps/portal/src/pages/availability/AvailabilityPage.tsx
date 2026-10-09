import { DEFAULT_TIME_ZONE } from '@fw-booking/shared';
import type { ReactNode } from 'react';
import { useOpeningHours } from '../../availability/queries.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { ExceptionsSection } from './ExceptionsSection.js';
import { OpeningHoursSection } from './OpeningHoursSection.js';

/** Wochenplan und Ausnahmen für Einzeltermine auf einer Seite. */
export function AvailabilityPage(): ReactNode {
  usePageTitle('Öffnungszeiten');
  const openingHours = useOpeningHours();
  return (
    <>
      <h1>Öffnungszeiten</h1>
      <OpeningHoursSection />
      {/* Die Zeitzone kommt mit dem Wochenplan; sie bestimmt das vorbelegte Datum. */}
      {!openingHours.isPending && (
        <ExceptionsSection timeZone={openingHours.data?.timeZone ?? DEFAULT_TIME_ZONE} />
      )}
    </>
  );
}
