import type { Service } from '@fw-booking/shared';
import type { ServiceDocument } from '../database/documents.js';

/** Gespeichertes Angebot → Antwortformat der Owner-API (`serviceSchema`). */
export function toServiceDto(doc: ServiceDocument): Service {
  const base = {
    id: doc._id.toHexString(),
    title: doc.title,
    description: doc.description,
    active: doc.active,
    durationMinutes: doc.durationMinutes,
    bookingRules: doc.bookingRules,
    sortOrder: doc.sortOrder,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
  return doc.type === 'single'
    ? {
        ...base,
        type: 'single',
        bufferMinutes: doc.bufferMinutes,
        slotGridMinutes: doc.slotGridMinutes,
      }
    : { ...base, type: 'group', defaultCapacity: doc.defaultCapacity };
}
