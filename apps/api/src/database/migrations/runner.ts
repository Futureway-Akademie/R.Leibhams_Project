import type { Db } from 'mongodb';
import { initialMigration } from './001-initial.js';
import type { Migration } from './migration.js';

/** Alle Migrationen in Ausführungsreihenfolge. Neue Schritte nur anhängen. */
export const MIGRATIONS: readonly Migration[] = [initialMigration];

export const MIGRATIONS_COLLECTION = '_migrations';
const LOCK_ID = '__lock';

interface MigrationRecord {
  _id: string;
  description?: string;
  appliedAt?: Date;
  lockedAt?: Date;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Wendet ausstehende Migrationen in Reihenfolge an und vermerkt sie in `_migrations`.
 * Eine Sperre verhindert parallele Läufe; bricht ein Schritt ab, bleibt er unvermerkt
 * und wird beim nächsten Lauf erneut ausgeführt.
 */
export async function runMigrations(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    throw new MigrationError('Doppelte Migrations-IDs');
  }

  const records = db.collection<MigrationRecord>(MIGRATIONS_COLLECTION);
  try {
    await records.insertOne({ _id: LOCK_ID, lockedAt: new Date() });
  } catch {
    throw new MigrationError(
      `Migration läuft bereits oder wurde abgebrochen. Sperre "${LOCK_ID}" in ${MIGRATIONS_COLLECTION} prüfen.`,
    );
  }

  try {
    const appliedIds = new Set(
      (await records.find({ _id: { $ne: LOCK_ID } }).toArray()).map((r) => r._id),
    );
    const unknown = [...appliedIds].filter((id) => !ids.includes(id));
    if (unknown.length > 0) {
      throw new MigrationError(
        `Datenbank enthält unbekannte Migrationen (${unknown.join(', ')}); der Code ist älter als die Datenbank.`,
      );
    }

    const result: MigrationResult = { applied: [], alreadyApplied: [] };
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        result.alreadyApplied.push(migration.id);
        continue;
      }
      await migration.up(db);
      await records.insertOne({
        _id: migration.id,
        description: migration.description,
        appliedAt: new Date(),
      });
      result.applied.push(migration.id);
    }
    return result;
  } finally {
    await records.deleteOne({ _id: LOCK_ID });
  }
}
