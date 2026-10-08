// Owner-Sitzungen und Login-Fehlversuche. Abgelaufene Einträge räumt MongoDB per TTL-Index auf.
import type { Db } from 'mongodb';
import { COLLECTIONS, collections } from '../documents.js';
import { ensureCollection } from './migration.js';
import type { Migration } from './migration.js';

const sha256Hex = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' };
const date = { bsonType: 'date' };

const authSessionsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'ownerId',
      'csrfToken',
      'createdAt',
      'lastSeenAt',
      'idleExpiresAt',
      'absoluteExpiresAt',
      'expiresAt',
    ],
    properties: {
      _id: sha256Hex,
      ownerId: { bsonType: 'objectId' },
      csrfToken: { bsonType: 'string', minLength: 32 },
      createdAt: date,
      lastSeenAt: date,
      idleExpiresAt: date,
      absoluteExpiresAt: date,
      expiresAt: date,
    },
  },
};

const loginAttemptsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'count', 'expiresAt'],
    properties: {
      _id: { bsonType: 'string', pattern: '^(email:[0-9a-f]{64}|ip:.+)$' },
      count: { bsonType: 'int', minimum: 1 },
      expiresAt: date,
    },
  },
};

export const authMigration: Migration = {
  id: '002-auth',
  description: 'Owner-Sitzungen und Login-Fehlversuche',

  async up(db: Db): Promise<void> {
    await ensureCollection(db, COLLECTIONS.authSessions, authSessionsValidator);
    await ensureCollection(db, COLLECTIONS.loginAttempts, loginAttemptsValidator);

    const c = collections(db);
    await c.authSessions.createIndexes([
      { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
      { key: { ownerId: 1 }, name: 'ownerId' },
    ]);
    await c.loginAttempts.createIndexes([
      { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
    ]);
  },
};
