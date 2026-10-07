import type { CourseRule, Session } from '@fw-booking/shared';
import type { CourseRuleDocument, SessionDocument } from '../database/documents.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

export function toSessionDto(doc: SessionDocument): Session {
  return {
    id: doc._id.toHexString(),
    serviceId: doc.serviceId.toHexString(),
    ruleId: doc.ruleId?.toHexString() ?? null,
    startsAt: iso(doc.startsAt),
    endsAt: iso(doc.endsAt),
    timeZone: doc.timeZone,
    capacity: doc.capacity,
    bookedCount: doc.bookedCount,
    status: doc.status,
    location: doc.location,
  };
}

export function toCourseRuleDto(doc: CourseRuleDocument): CourseRule {
  return {
    id: doc._id.toHexString(),
    serviceId: doc.serviceId.toHexString(),
    weekdays: doc.weekdays,
    startTime: doc.startTime,
    validFrom: doc.validFrom,
    validUntil: doc.validUntil,
    capacity: doc.capacity,
    location: doc.location,
  };
}
