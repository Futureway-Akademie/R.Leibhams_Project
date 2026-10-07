import { Writable } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Db } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.factory.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { startReplSet, testConfig } from '../testing/mongo.js';
import type { MongoClient } from 'mongodb';

describe('API mit erreichbarer Datenbank', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestExpressApplication;
  const logLines: string[] = [];

  beforeAll(async () => {
    replSet = await startReplSet();
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    });
    app = await createApp(testConfig(replSet.getUri(), { logLevel: 'info' }), { logStream });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await replSet.stop();
  });

  it('GET /health meldet API und Datenbank als verfügbar', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', db: 'up' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('liegt außerhalb des /api-Präfixes', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(404);
  });

  it('verrät das Framework nicht über X-Powered-By', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('stellt eine transaktionsfähige Datenbank bereit', async () => {
    const client = app.get<MongoClient>(MONGO_CLIENT);
    const db = app.get<Db>(MONGO_DB);
    expect(db.databaseName).toBe('fw_booking_test');
    const collection = db.collection('tx_check');
    await client.withSession((session) =>
      session.withTransaction(() => collection.insertOne({ ok: true }, { session })),
    );
    expect(await collection.countDocuments()).toBe(1);
  });

  it('schreibt Cookies und Query-Strings nicht ins Log', async () => {
    await request(app.getHttpServer())
      .get('/api/unbekannt?token=geheimes-token-123')
      .set('Cookie', 'session=geheime-session-456')
      .set('Authorization', 'Bearer geheimer-bearer-789')
      .expect(404);
    const log = logLines.join('');
    expect(log).toContain('/api/unbekannt');
    expect(log).not.toContain('geheimes-token-123');
    expect(log).not.toContain('geheime-session-456');
    expect(log).not.toContain('geheimer-bearer-789');
  });
});

describe('API ohne erreichbare Datenbank', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Port 1 ist nicht belegt; die Verbindung schlägt schnell fehl.
    app = await createApp(
      testConfig('mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&directConnection=true'),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('startet trotzdem und meldet 503 mit db: down', async () => {
    const started = Date.now();
    const response = await request(app.getHttpServer()).get('/health').expect(503);
    expect(response.body).toEqual({ status: 'error', db: 'down' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
