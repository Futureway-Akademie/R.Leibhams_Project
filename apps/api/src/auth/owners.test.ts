import { MongoClient } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collections } from '../database/documents.js';
import { runMigrations } from '@fw-booking/db';
import { startReplSet } from '../testing/mongo.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { OwnerCreationError, createOwner } from './owners.js';

describe('Passwort-Hashing', () => {
  it('verwendet Argon2id und prüft korrekt', async () => {
    const hash = await hashPassword('ein-sicheres-passwort');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verifyPassword(hash, 'ein-sicheres-passwort')).toBe(true);
    expect(await verifyPassword(hash, 'ein-anderes-passwort')).toBe(false);
  });

  it('behandelt beschädigte Hashes als falsch', async () => {
    expect(await verifyPassword('kein-hash', 'egal')).toBe(false);
  });
});

describe('createOwner', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    replSet = await startReplSet();
    client = await MongoClient.connect(replSet.getUri());
    await runMigrations(client.db('owners_test'));
  });

  afterAll(async () => {
    await client.close();
    await replSet.stop();
  });

  it('legt einen aktiven Owner mit normalisierter E-Mail und Hash an', async () => {
    const db = client.db('owners_test');
    const id = await createOwner(db, ' Neu@Example.TEST ', 'mindestens-zwoelf');
    const owner = await collections(db).owners.findOne({ _id: id });
    expect(owner).toMatchObject({ email: 'neu@example.test', status: 'active' });
    expect(owner?.passwordHash).not.toContain('mindestens-zwoelf');
  });

  it('lehnt doppelte E-Mail-Adressen ab', async () => {
    const db = client.db('owners_test');
    await createOwner(db, 'doppelt@example.test', 'mindestens-zwoelf');
    await expect(createOwner(db, 'DOPPELT@example.test', 'mindestens-zwoelf')).rejects.toThrow(
      OwnerCreationError,
    );
  });

  it('verlangt mindestens 12 Zeichen und eine gültige E-Mail', async () => {
    const db = client.db('owners_test');
    await expect(createOwner(db, 'kurz@example.test', 'zu-kurz')).rejects.toThrow(/12 Zeichen/);
    await expect(createOwner(db, 'keine-email', 'mindestens-zwoelf')).rejects.toThrow(/E-Mail/);
  });
});
