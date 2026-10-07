import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { AppConfig } from '../config/config.js';

/** Gleiche Hauptversion wie die lokale Docker-Infrastruktur (infra/docker-compose.yml). */
export const TEST_MONGODB_VERSION = '8.0.32';

/** Startet ein echtes Single-Node-Replica-Set im Speicher (Transaktionen verfügbar). */
export function startReplSet(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: TEST_MONGODB_VERSION },
  });
}

export function testConfig(mongoUri: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const url = new URL(mongoUri);
  url.pathname = '/fw_booking_test';
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    mongodb: { uri: url.toString(), dbName: 'fw_booking_test' },
    logLevel: 'silent',
    ...overrides,
  };
}
