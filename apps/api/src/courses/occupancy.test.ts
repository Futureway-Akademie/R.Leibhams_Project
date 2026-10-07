import { MongoBulkWriteError, MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { isDuplicateOccurrence, isOccupancyConflict } from './occupancy.js';

describe('Erkennung von Index-Verletzungen', () => {
  const serverError = (message: string) =>
    new MongoServerError({ message, code: 11000, errmsg: message });

  it('erkennt belegte Einheiten, auch als Bulk-Fehler', () => {
    const message =
      'E11000 duplicate key error collection: db.resourceOccupancy index: resource_unit_unique dup key: {}';
    expect(isOccupancyConflict(serverError(message))).toBe(true);
    // Das Ergebnisobjekt wird für die Erkennung nicht benötigt.
    const bulk = new MongoBulkWriteError({ message, code: 11000, writeErrors: [] }, {} as never);
    expect(isOccupancyConflict(bulk)).toBe(true);
    expect(isDuplicateOccurrence(bulk)).toBe(false);
  });

  it('erkennt doppelte Regeltermine', () => {
    expect(
      isDuplicateOccurrence(
        serverError(
          'E11000 duplicate key error collection: db.sessions index: ruleId_localStart_unique',
        ),
      ),
    ).toBe(true);
  });

  it('ignoriert andere Fehler', () => {
    expect(isOccupancyConflict(new Error('index: resource_unit_unique'))).toBe(false);
  });
});
