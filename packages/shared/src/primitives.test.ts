import { describe, expect, it } from 'vitest';
import {
  idempotencyKeySchema,
  localDateTimeSchema,
  localTimeSchema,
  localTimeToMinutes,
  objectIdSchema,
  timeZoneSchema,
  unitMinutesSchema,
  utcDateTimeSchema,
} from './primitives.js';

describe('objectIdSchema', () => {
  it('akzeptiert 24 Hex-Zeichen', () => {
    expect(objectIdSchema.safeParse('65f1a2b3c4d5e6f7a8b9c0d1').success).toBe(true);
  });
  it.each(['65f1a2b3c4d5e6f7a8b9c0d', '65F1A2B3C4D5E6F7A8B9C0D1', 'xyz'])('lehnt %s ab', (id) => {
    expect(objectIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('utcDateTimeSchema', () => {
  it('akzeptiert UTC mit Z', () => {
    expect(utcDateTimeSchema.safeParse('2026-10-07T08:00:00Z').success).toBe(true);
  });
  it('lehnt Offsets und Zeiten ohne Zone ab', () => {
    expect(utcDateTimeSchema.safeParse('2026-10-07T10:00:00+02:00').success).toBe(false);
    expect(utcDateTimeSchema.safeParse('2026-10-07T08:00:00').success).toBe(false);
  });
});

describe('lokale Zeiten', () => {
  it.each(['00:00', '09:30', '23:59', '24:00'])('akzeptiert Uhrzeit %s', (t) => {
    expect(localTimeSchema.safeParse(t).success).toBe(true);
  });
  it.each(['9:30', '24:30', '12:60', '12:00:00'])('lehnt Uhrzeit %s ab', (t) => {
    expect(localTimeSchema.safeParse(t).success).toBe(false);
  });
  it('validiert lokale Zeitpunkte ohne Zeitzone', () => {
    expect(localDateTimeSchema.safeParse('2026-12-24T14:00').success).toBe(true);
    expect(localDateTimeSchema.safeParse('2026-12-24T14:00Z').success).toBe(false);
  });
  it('rechnet Uhrzeit in Minuten um', () => {
    expect(localTimeToMinutes('09:45')).toBe(585);
    expect(localTimeToMinutes('24:00')).toBe(1440);
  });
});

describe('timeZoneSchema', () => {
  it('akzeptiert IANA-Zeitzonen', () => {
    expect(timeZoneSchema.safeParse('Europe/Berlin').success).toBe(true);
  });
  it('lehnt unbekannte Zeitzonen ab', () => {
    expect(timeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
});

describe('unitMinutesSchema', () => {
  it('verlangt Vielfache von 5', () => {
    expect(unitMinutesSchema.safeParse(45).success).toBe(true);
    expect(unitMinutesSchema.safeParse(42).success).toBe(false);
    expect(unitMinutesSchema.safeParse(-5).success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('akzeptiert UUIDs und lange Token', () => {
    expect(idempotencyKeySchema.safeParse('3f1c2a9e-7b4d-4c1e-9a2b-1d2e3f4a5b6c').success).toBe(
      true,
    );
  });
  it('lehnt zu kurze oder unzulässige Schlüssel ab', () => {
    expect(idempotencyKeySchema.safeParse('kurz').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('a'.repeat(20) + ' ').success).toBe(false);
  });
});
