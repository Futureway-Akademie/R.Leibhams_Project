import type { Booking } from '@fw-booking/shared';
import type { BookingDocument } from '../database/documents.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

/** Buchung für angemeldete Owner. Enthält personenbezogene Daten, nie öffentlich ausliefern. */
export function toBookingDto(doc: BookingDocument): Booking {
  return {
    id: doc._id.toHexString(),
    serviceId: doc.serviceId.toHexString(),
    type: doc.type,
    sessionId: doc.sessionId?.toHexString() ?? null,
    startsAt: iso(doc.startsAt),
    endsAt: iso(doc.endsAt),
    timeZone: doc.timeZone,
    status: doc.status,
    participant: {
      name: doc.participant.name,
      email: doc.participant.email,
      phone: doc.participant.phone,
    },
    rebookedToBookingId: doc.rebookedToBookingId?.toHexString() ?? null,
    ownerCancellationReason: doc.ownerCancellationReason ?? null,
    createdAt: iso(doc.createdAt),
  };
}
