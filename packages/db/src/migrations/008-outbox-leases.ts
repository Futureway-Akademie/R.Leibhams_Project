// Indizes für den Worker: abgelaufene Leases finden und versendete Jobs nach 30 Tagen löschen.
import type { Db } from 'mongodb';
import { collections } from '../documents.js';
import type { Migration } from './migration.js';

/** Aufbewahrung erfolgreich versendeter Jobs. */
export const SENT_JOB_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export const outboxLeasesMigration: Migration = {
  id: '008-outbox-leases',
  description: 'Lease-Index und Löschfrist für versendete Outbox-Jobs',

  async up(db: Db): Promise<void> {
    await collections(db).outboxJobs.createIndexes([
      { key: { status: 1, leaseUntil: 1 }, name: 'status_leaseUntil' },
      {
        key: { completedAt: 1 },
        name: 'completedAt_ttl_sent',
        expireAfterSeconds: SENT_JOB_RETENTION_SECONDS,
        partialFilterExpression: { status: 'sent' },
      },
    ]);
  },
};
