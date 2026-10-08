// Puffer und Slot-Raster entfallen (task-2-16): Die Dauer enthält einen Puffer bereits,
// Einzeltermine werden im 5-Minuten-Raster angeboten.
import type { Db } from 'mongodb';
import { COLLECTIONS, collections } from '../documents.js';
import type { Migration } from './migration.js';

interface CollectionInfo {
  options?: { validator?: { $jsonSchema?: { properties?: Record<string, unknown> } } };
}

export const removeBufferAndGridMigration: Migration = {
  id: '006-remove-buffer-and-grid',
  description: 'Felder bufferMinutes und slotGridMinutes aus Angeboten entfernen',

  async up(db: Db): Promise<void> {
    await collections(db).services.updateMany(
      {},
      { $unset: { bufferMinutes: '', slotGridMinutes: '' } },
    );

    // Bestehenden Validator übernehmen und nur die Regel für bufferMinutes entfernen.
    const [info] = (await db
      .listCollections({ name: COLLECTIONS.services })
      .toArray()) as CollectionInfo[];
    const validator = info?.options?.validator;
    const properties = validator?.$jsonSchema?.properties;
    if (validator && properties && 'bufferMinutes' in properties) {
      delete properties.bufferMinutes;
      await db.command({
        collMod: COLLECTIONS.services,
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
  },
};
