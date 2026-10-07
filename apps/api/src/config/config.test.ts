import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = { MONGODB_URI: 'mongodb://localhost:27017/fw_booking?replicaSet=rs0' };

describe('loadConfig', () => {
  it('liest Standardwerte und den Datenbanknamen aus der URI', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      mongodb: { uri: validEnv.MONGODB_URI, dbName: 'fw_booking' },
      logLevel: 'info',
    });
  });

  it('übernimmt gesetzte Werte', () => {
    const config = loadConfig({
      MONGODB_URI: 'mongodb+srv://user:pw@cluster.example.net/kunde_a?retryWrites=true',
      PORT: '8080',
      HOST: '0.0.0.0',
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({
      port: 8080,
      host: '0.0.0.0',
      nodeEnv: 'production',
      logLevel: 'warn',
    });
    expect(config.mongodb.dbName).toBe('kunde_a');
  });

  it('verlangt MONGODB_URI', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it.each([
    'postgres://localhost/db',
    'mongodb://localhost:27017',
    'mongodb://localhost:27017/?replicaSet=rs0',
  ])('lehnt %s ab', (uri) => {
    expect(() => loadConfig({ MONGODB_URI: uri })).toThrow(/MONGODB_URI/);
  });

  it('lehnt ungültige Ports ab', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('gibt in Fehlermeldungen keine Werte aus', () => {
    const secret = 'S3cr3t-Passw0rt';
    try {
      loadConfig({ MONGODB_URI: `mysql://admin:${secret}@db.example.net/x` });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('MONGODB_URI');
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
