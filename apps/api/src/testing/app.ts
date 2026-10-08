import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import request from 'supertest';
import { createApp } from '../app.factory.js';
import { createOwner } from '../auth/owners.js';
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
  // supertest hängt je Anfrage einen Listener an den Server; bei parallelen Anfragen in Tests
  // sonst Warnungen („MaxListenersExceeded“).
  (app.getHttpServer() as { setMaxListeners(n: number): void }).setMaxListeners(500);
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

export interface OwnerSession {
  cookie: string;
  csrfToken: string;
}

/** Legt (falls nötig) einen Test-Owner an und meldet ihn an. */
export async function loginAsOwner(
  t: TestApp,
  email = 'owner@example.test',
  password = 'test-passwort-lang',
): Promise<OwnerSession> {
  try {
    await createOwner(t.db, email, password);
  } catch {
    // existiert bereits
  }
  const response = await request(t.app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const cookie = setCookie[0]?.split(';')[0];
  if (!cookie) throw new Error('Kein Sitzungs-Cookie');
  return { cookie, csrfToken: (response.body as { csrfToken: string }).csrfToken };
}
