// Index für das Buchungslimit je E-Mail-Adresse (neue Buchungen der letzten Stunde).
import type { Db } from 'mongodb';
import { collections } from '../documents.js';
import type { Migration } from './migration.js';

export const bookingEmailIndexMigration: Migration = {
  id: '007-booking-email-index',
  description: 'Index participantEmailKey + createdAt für das Buchungslimit je E-Mail',

  async up(db: Db): Promise<void> {
    await collections(db).bookings.createIndexes([
      { key: { participantEmailKey: 1, createdAt: -1 }, name: 'participantEmailKey_createdAt' },
    ]);
  },
};
