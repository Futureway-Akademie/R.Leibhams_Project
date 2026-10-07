// Grundstruktur: Collections, Validatoren für kritische Invarianten, Indizes, Standardeinstellungen.
// Die Validatoren sind eine zweite Verteidigungslinie; die vollständigen Regeln prüft die API mit Zod.
import {
  DEFAULT_BOOKING_HORIZON_DAYS,
  DEFAULT_CHANGE_DEADLINE_MINUTES,
  DEFAULT_MIN_LEAD_MINUTES,
  DEFAULT_REMINDER_LEAD_MINUTES,
  DEFAULT_TIME_ZONE,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  MIN_GROUP_CAPACITY,
  OCCUPANCY_UNIT_MINUTES,
  appointmentTypeSchema,
  bookingStatusSchema,
  sessionStatusSchema,
} from '@fw-booking/shared';
import type { Db } from 'mongodb';
import { COLLECTIONS, SETTINGS_ID, collections } from '../documents.js';
import type { SettingsDocument } from '../documents.js';
import { ensureCollection } from './migration.js';
import type { Migration } from './migration.js';

const int = (minimum?: number, maximum?: number) => ({
  bsonType: 'int',
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});
const date = { bsonType: 'date' };
const objectId = { bsonType: 'objectId' };
const nonEmptyString = { bsonType: 'string', minLength: 1 };

const ownersValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['email', 'passwordHash', 'status', 'createdAt'],
    properties: {
      email: nonEmptyString,
      passwordHash: nonEmptyString,
      status: { enum: ['active', 'disabled'] },
      createdAt: date,
    },
  },
};

export const servicesValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['type', 'title', 'durationMinutes', 'active', 'createdAt'],
    properties: {
      type: { enum: appointmentTypeSchema.options },
      title: nonEmptyString,
      durationMinutes: int(MIN_DURATION_MINUTES, MAX_DURATION_MINUTES),
      active: { bsonType: 'bool' },
      defaultCapacity: int(MIN_GROUP_CAPACITY),
      bufferMinutes: int(0),
    },
  },
};

const sessionsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'serviceId',
      'localStart',
      'startsAt',
      'endsAt',
      'timeZone',
      'capacity',
      'bookedCount',
      'status',
    ],
    properties: {
      serviceId: objectId,
      ruleId: { bsonType: ['objectId', 'null'] },
      localStart: nonEmptyString,
      startsAt: date,
      endsAt: date,
      timeZone: nonEmptyString,
      capacity: int(MIN_GROUP_CAPACITY),
      bookedCount: int(0),
      status: { enum: sessionStatusSchema.options },
    },
  },
  $expr: {
    $and: [{ $lte: ['$bookedCount', '$capacity'] }, { $lt: ['$startsAt', '$endsAt'] }],
  },
};

const bookingsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'serviceId',
      'type',
      'sessionId',
      'startsAt',
      'endsAt',
      'timeZone',
      'status',
      'participant',
      'participantEmailKey',
      'idempotencyKey',
      'createdAt',
    ],
    properties: {
      serviceId: objectId,
      type: { enum: appointmentTypeSchema.options },
      sessionId: { bsonType: ['objectId', 'null'] },
      startsAt: date,
      endsAt: date,
      status: { enum: bookingStatusSchema.options },
      participant: {
        bsonType: 'object',
        required: ['name', 'email', 'phone'],
        properties: { name: nonEmptyString, email: nonEmptyString, phone: nonEmptyString },
      },
      participantEmailKey: nonEmptyString,
      idempotencyKey: nonEmptyString,
    },
  },
  $expr: {
    $and: [
      { $lt: ['$startsAt', '$endsAt'] },
      // sessionId ist genau bei Gruppenkursen gesetzt.
      { $eq: [{ $eq: ['$type', 'group'] }, { $eq: [{ $type: '$sessionId' }, 'objectId'] }] },
    ],
  },
};

const occupancyValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['resourceId', 'unitStart', 'refType', 'refId'],
    properties: {
      resourceId: nonEmptyString,
      unitStart: date,
      refType: { enum: ['booking', 'session'] },
      refId: objectId,
    },
  },
  // Einheiten liegen exakt auf dem 5-Minuten-Raster.
  $expr: { $eq: [{ $mod: [{ $toLong: '$unitStart' }, OCCUPANCY_UNIT_MINUTES * 60_000] }, 0] },
};

const actionTokensValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['tokenHash', 'bookingId', 'status', 'expiresAt', 'createdAt'],
    properties: {
      tokenHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      bookingId: objectId,
      status: { enum: ['active', 'used', 'revoked'] },
      expiresAt: date,
    },
  },
};

const outboxJobsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['type', 'status', 'dedupeKey', 'dueAt', 'attempts', 'createdAt'],
    properties: {
      type: nonEmptyString,
      status: { enum: ['pending', 'processing', 'sent', 'failed'] },
      dedupeKey: nonEmptyString,
      dueAt: date,
      attempts: int(0),
      leaseUntil: { bsonType: ['date', 'null'] },
    },
  },
};

export const initialMigration: Migration = {
  id: '001-initial',
  description: 'Collections, Validatoren, Indizes und Standardeinstellungen',

  async up(db: Db): Promise<void> {
    await ensureCollection(db, COLLECTIONS.settings);
    await ensureCollection(db, COLLECTIONS.owners, ownersValidator);
    await ensureCollection(db, COLLECTIONS.services, servicesValidator);
    await ensureCollection(db, COLLECTIONS.openingHours);
    await ensureCollection(db, COLLECTIONS.availabilityExceptions);
    await ensureCollection(db, COLLECTIONS.courseRules);
    await ensureCollection(db, COLLECTIONS.sessions, sessionsValidator);
    await ensureCollection(db, COLLECTIONS.bookings, bookingsValidator);
    await ensureCollection(db, COLLECTIONS.resourceOccupancy, occupancyValidator);
    await ensureCollection(db, COLLECTIONS.actionTokens, actionTokensValidator);
    await ensureCollection(db, COLLECTIONS.outboxJobs, outboxJobsValidator);
    await ensureCollection(db, COLLECTIONS.auditEvents);

    const c = collections(db);
    await c.owners.createIndexes([{ key: { email: 1 }, name: 'email_unique', unique: true }]);
    await c.services.createIndexes([{ key: { active: 1, type: 1 }, name: 'active_type' }]);
    await c.openingHours.createIndexes([
      { key: { weekday: 1 }, name: 'weekday_unique', unique: true },
    ]);
    await c.availabilityExceptions.createIndexes([
      { key: { start: 1, end: 1 }, name: 'start_end' },
    ]);
    await c.courseRules.createIndexes([{ key: { serviceId: 1 }, name: 'serviceId' }]);
    await c.sessions.createIndexes([
      { key: { startsAt: 1 }, name: 'startsAt' },
      { key: { serviceId: 1, startsAt: 1 }, name: 'serviceId_startsAt' },
      {
        key: { ruleId: 1, localStart: 1 },
        name: 'ruleId_localStart_unique',
        unique: true,
        partialFilterExpression: { ruleId: { $type: 'objectId' } },
      },
    ]);
    await c.bookings.createIndexes([
      { key: { idempotencyKey: 1 }, name: 'idempotencyKey_unique', unique: true },
      { key: { startsAt: 1 }, name: 'startsAt' },
      { key: { serviceId: 1, startsAt: 1 }, name: 'serviceId_startsAt' },
      { key: { sessionId: 1, status: 1 }, name: 'sessionId_status' },
      {
        key: { sessionId: 1, participantEmailKey: 1 },
        name: 'session_participant_active_unique',
        unique: true,
        partialFilterExpression: { status: 'confirmed', sessionId: { $type: 'objectId' } },
      },
    ]);
    await c.resourceOccupancy.createIndexes([
      { key: { resourceId: 1, unitStart: 1 }, name: 'resource_unit_unique', unique: true },
      { key: { refType: 1, refId: 1 }, name: 'ref' },
    ]);
    await c.actionTokens.createIndexes([
      { key: { tokenHash: 1 }, name: 'tokenHash_unique', unique: true },
      { key: { bookingId: 1 }, name: 'bookingId' },
    ]);
    await c.outboxJobs.createIndexes([
      { key: { dedupeKey: 1 }, name: 'dedupeKey_unique', unique: true },
      { key: { status: 1, dueAt: 1 }, name: 'status_dueAt' },
      { key: { bookingId: 1 }, name: 'bookingId' },
    ]);
    await c.auditEvents.createIndexes([
      { key: { at: -1 }, name: 'at' },
      { key: { objectType: 1, objectId: 1 }, name: 'object' },
    ]);

    // Nur beim ersten Mal anlegen; spätere Anpassungen des Owners bleiben erhalten.
    const defaults: Omit<SettingsDocument, '_id'> = {
      timeZone: DEFAULT_TIME_ZONE,
      defaultMinLeadMinutes: DEFAULT_MIN_LEAD_MINUTES,
      defaultHorizonDays: DEFAULT_BOOKING_HORIZON_DAYS,
      defaultChangeDeadlineMinutes: DEFAULT_CHANGE_DEADLINE_MINUTES,
      reminderLeadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
      updatedAt: new Date(),
    };
    await c.settings.updateOne({ _id: SETTINGS_ID }, { $setOnInsert: defaults }, { upsert: true });
  },
};
