// Pflicht-Bestätigung der Datenschutzhinweise: jede Buchung speichert den Zeitpunkt.
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../documents.js';
import { bookingsValidator } from './001-initial.js';
import type { Migration } from './migration.js';

export const bookingPrivacyMigration: Migration = {
  id: '005-booking-privacy',
  description: 'Zeitpunkt der Bestätigung der Datenschutzhinweise in Buchungen',

  async up(db: Db): Promise<void> {
    const schema = bookingsValidator.$jsonSchema;
    await db.command({
      collMod: COLLECTIONS.bookings,
      validator: {
        ...bookingsValidator,
        $jsonSchema: {
          ...schema,
          required: [...schema.required, 'privacyAcceptedAt'],
          properties: { ...schema.properties, privacyAcceptedAt: { bsonType: 'date' } },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });
  },
};
