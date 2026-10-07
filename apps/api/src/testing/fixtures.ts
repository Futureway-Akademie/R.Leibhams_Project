// Testdaten-Fabriken für Dokumente, die direkt in die Datenbank geschrieben werden.
import { ObjectId } from 'mongodb';
import type {
  BookingDocument,
  GroupServiceDocument,
  SingleServiceDocument,
} from '../database/documents.js';

const NOW = new Date('2026-10-01T08:00:00Z');
const RULES = { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null };

export function groupService(overrides: Partial<GroupServiceDocument> = {}): GroupServiceDocument {
  return {
    _id: new ObjectId(),
    type: 'group',
    title: 'Yoga',
    description: null,
    active: true,
    durationMinutes: 75,
    defaultCapacity: 12,
    bookingRules: RULES,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function singleService(
  overrides: Partial<SingleServiceDocument> = {},
): SingleServiceDocument {
  return {
    _id: new ObjectId(),
    type: 'single',
    title: 'Haarschnitt',
    description: null,
    active: true,
    durationMinutes: 30,
    bufferMinutes: 0,
    slotGridMinutes: 30,
    bookingRules: RULES,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Bestätigte Kursbuchung (für Buchungshistorie in Tests). */
export function groupBooking(
  sessionId: ObjectId,
  serviceId: ObjectId,
  overrides: Partial<BookingDocument> = {},
): BookingDocument {
  return {
    _id: new ObjectId(),
    serviceId,
    type: 'group',
    sessionId,
    startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 3_600_000),
    timeZone: 'Europe/Berlin',
    status: 'confirmed',
    participant: { name: 'Erika', email: 'erika@example.test', phone: '030 123456' },
    participantEmailKey: 'erika@example.test',
    idempotencyKey: new ObjectId().toHexString(),
    privacyAcceptedAt: new Date(),
    rebookedToBookingId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
