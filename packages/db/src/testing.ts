// Hilfen für Integrationstests gegen ein echtes Replica Set (nicht für den Produktivbetrieb).
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Gleiche Hauptversion wie die lokale Docker-Infrastruktur (infra/docker-compose.yml). */
export const TEST_MONGODB_VERSION = '8.0.32';

/** Startet ein echtes Single-Node-Replica-Set im Speicher (Transaktionen verfügbar). */
export function startReplSet(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: TEST_MONGODB_VERSION },
  });
}
