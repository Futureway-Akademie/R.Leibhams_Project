// Öffentliche Kalenderkennung je Installation (für die Einbindung des Widgets).
import { randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { SETTINGS_ID, collections } from '../documents.js';
import type { Migration } from './migration.js';

export function newPublicCalendarId(): string {
  return `cal_${randomBytes(12).toString('base64url')}`;
}

export const publicCalendarMigration: Migration = {
  id: '004-public-calendar',
  description: 'Öffentliche Kalenderkennung',

  async up(db: Db): Promise<void> {
    // Nur setzen, wenn noch keine Kennung existiert; bestehende Einbindungen bleiben gültig.
    await collections(db).settings.updateOne(
      { _id: SETTINGS_ID, publicCalendarId: { $exists: false } },
      { $set: { publicCalendarId: newPublicCalendarId() } },
    );
  },
};
