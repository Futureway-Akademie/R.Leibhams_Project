import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = { MONGODB_URI: 'mongodb://localhost:27017/fw_booking?replicaSet=rs0' };

describe('loadConfig', () => {
  it('liest Standardwerte und den Datenbanknamen', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'development',
      mongodb: { uri: validEnv.MONGODB_URI, dbName: 'fw_booking' },
      logLevel: 'info',
      concurrency: 4,
      pollIntervalMs: 5_000,
    });
  });

  it('übernimmt gesetzte Werte', () => {
    expect(
      loadConfig({ ...validEnv, WORKER_CONCURRENCY: '8', WORKER_POLL_INTERVAL_MS: '1000' }),
    ).toMatchObject({ concurrency: 8, pollIntervalMs: 1000 });
  });

  it.each([
    [{}, /MONGODB_URI/],
    [{ ...validEnv, WORKER_CONCURRENCY: '0' }, /WORKER_CONCURRENCY/],
    [{ ...validEnv, WORKER_POLL_INTERVAL_MS: '10' }, /WORKER_POLL_INTERVAL_MS/],
  ])('lehnt ungültige Konfiguration ab (%#)', (env, pattern) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(pattern);
  });

  it('nennt in Fehlern keine Werte', () => {
    expect(() => loadConfig({ MONGODB_URI: 'postgres://user:geheim@host/db' })).toThrow(
      /^(?![\s\S]*geheim)/,
    );
  });
});
