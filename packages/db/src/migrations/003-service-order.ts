// Manuelle Reihenfolge der Angebote: Feld sortOrder (Pflicht, ganzzahlig ≥ 0) mit Index.
import type { Db } from 'mongodb';
import { COLLECTIONS, collections } from '../documents.js';
import { servicesValidator } from './001-initial.js';
import type { Migration } from './migration.js';

export const serviceOrderMigration: Migration = {
  id: '003-service-order',
  description: 'Reihenfolge der Angebote (sortOrder)',

  async up(db: Db): Promise<void> {
    const services = collections(db).services;

    // Bestehende Angebote ohne Position in Anlagereihenfolge nummerieren.
    const withOrder = await services.countDocuments({ sortOrder: { $exists: true } });
    const unordered = await services
      .find({ sortOrder: { $exists: false } }, { sort: { createdAt: 1 }, projection: { _id: 1 } })
      .toArray();
    for (const [index, service] of unordered.entries()) {
      await services.updateOne({ _id: service._id }, { $set: { sortOrder: withOrder + index } });
    }

    const schema = servicesValidator.$jsonSchema;
    await db.command({
      collMod: COLLECTIONS.services,
      validator: {
        $jsonSchema: {
          ...schema,
          required: [...schema.required, 'sortOrder'],
          properties: { ...schema.properties, sortOrder: { bsonType: 'int', minimum: 0 } },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await services.createIndexes([{ key: { sortOrder: 1 }, name: 'sortOrder' }]);
  },
};
