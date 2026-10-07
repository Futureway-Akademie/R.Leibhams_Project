import { ObjectId } from 'mongodb';
import type { ClientSession, Collection } from 'mongodb';
import type { AuditEventDocument } from '../database/documents.js';

export interface AuditEntry {
  actor: AuditEventDocument['actor'];
  action: string;
  objectType: string;
  objectId: ObjectId | string;
  /** Nur begrenzte Informationen, keine personenbezogenen Daten oder Secrets. */
  details?: Record<string, unknown>;
}

export async function recordAudit(
  auditEvents: Collection<AuditEventDocument>,
  entry: AuditEntry,
  session?: ClientSession,
): Promise<void> {
  await auditEvents.insertOne(
    {
      _id: new ObjectId(),
      at: new Date(),
      actor: entry.actor,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      details: entry.details ?? {},
    },
    session ? { session } : {},
  );
}
