// Index für die Liste fehlgeschlagener Benachrichtigungen (neueste zuerst).
import type { Db } from 'mongodb';
import { collections } from '../documents.js';
import type { Migration } from './migration.js';

export const failedJobsIndexMigration: Migration = {
  id: '009-failed-jobs-index',
  description: 'Index status + failedAt für fehlgeschlagene Outbox-Jobs',

  async up(db: Db): Promise<void> {
    await collections(db).outboxJobs.createIndexes([
      { key: { status: 1, failedAt: -1 }, name: 'status_failedAt' },
    ]);
  },
};
