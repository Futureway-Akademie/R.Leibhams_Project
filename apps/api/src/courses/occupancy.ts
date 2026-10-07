import { OCCUPANCY_UNIT_MINUTES } from '@fw-booking/shared';
import { MongoServerError, ObjectId } from 'mongodb';
import type { ClientSession } from 'mongodb';
import { DEFAULT_RESOURCE_ID } from '../database/documents.js';
import type {
  Collections,
  OccupancyRefType,
  ResourceOccupancyDocument,
} from '../database/documents.js';

const UNIT_MS = OCCUPANCY_UNIT_MINUTES * 60_000;

/** Belegungseinheiten für [start, end); Grenzen liegen auf dem 5-Minuten-Raster. */
export function occupancyUnits(
  start: Date,
  end: Date,
  refType: OccupancyRefType,
  refId: ObjectId,
): ResourceOccupancyDocument[] {
  const units: ResourceOccupancyDocument[] = [];
  for (let ms = start.getTime(); ms < end.getTime(); ms += UNIT_MS) {
    units.push({
      _id: new ObjectId(),
      resourceId: DEFAULT_RESOURCE_ID,
      unitStart: new Date(ms),
      refType,
      refId,
    });
  }
  return units;
}

export async function releaseOccupancy(
  c: Collections,
  refType: OccupancyRefType,
  refId: ObjectId,
  session: ClientSession,
): Promise<void> {
  await c.resourceOccupancy.deleteMany({ refType, refId }, { session });
}

/**
 * Ob ein Fehler eine Verletzung des eindeutigen Index `indexName` meldet. Erkennung über den
 * Indexnamen, weil Bulk-Fehler (insertMany) kein `keyPattern` mitliefern.
 */
function violatesUniqueIndex(error: unknown, indexName: string): boolean {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    error.message.includes(`index: ${indexName}`)
  );
}

/** Ob ein Fehler eine bereits belegte Einheit der Ressource meldet. */
export function isOccupancyConflict(error: unknown): boolean {
  return violatesUniqueIndex(error, 'resource_unit_unique');
}

/** Ob ein Fehler einen bereits erzeugten Regeltermin meldet (ruleId + localStart). */
export function isDuplicateOccurrence(error: unknown): boolean {
  return violatesUniqueIndex(error, 'ruleId_localStart_unique');
}
