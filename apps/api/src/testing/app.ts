import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { createApp } from '../app.factory.js';
import type { AppConfig } from '../config/config.js';
import { runMigrations } from '../database/migrations/runner.js';
import { testConfig } from './mongo.js';

let dbCounter = 0;

export interface TestApp {
  app: NestExpressApplication;
  db: Db;
  config: AppConfig;
  close(): Promise<void>;
}

/** Startet die API gegen eine frisch migrierte, eigene Testdatenbank. */
export async function createTestApp(
  mongoUri: string,
  overrides: Partial<AppConfig> = {},
): Promise<TestApp> {
  dbCounter += 1;
  const dbName = `api_test_${String(process.pid)}_${String(dbCounter)}`;
  const base = testConfig(mongoUri, overrides);
  const url = new URL(base.mongodb.uri);
  url.pathname = `/${dbName}`;
  const config: AppConfig = { ...base, mongodb: { uri: url.toString(), dbName } };

  const client = await MongoClient.connect(config.mongodb.uri);
  const db = client.db(dbName);
  await runMigrations(db);

  const app = await createApp(config);
  await app.init();
  return {
    app,
    db,
    config,
    async close() {
      await app.close();
      await client.close();
    },
  };
}
