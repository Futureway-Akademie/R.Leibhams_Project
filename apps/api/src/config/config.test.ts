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
      session: { cookieSecure: false },
      trustProxy: 0,
      cors: { allowedOrigins: [] },
      rateLimits: {
        read: { limit: 120, windowMs: 60_000 },
        booking: { limit: 10, windowMs: 600_000 },
        manageRead: { limit: 60, windowMs: 60_000 },
        manageWrite: { limit: 10, windowMs: 600_000 },
      },
      bookingsPerEmailPerHour: 5,
    });
  });

  it('liest freigegebene Origins und Grenzen', () => {
    const config = loadConfig({
      ...validEnv,
      CORS_ALLOWED_ORIGINS: ' https://kunde.de, https://www.kunde.de ,',
      RATE_LIMIT_BOOKING: '0',
      BOOKING_LIMIT_PER_EMAIL: '3',
    });
    expect(config.cors.allowedOrigins).toEqual(['https://kunde.de', 'https://www.kunde.de']);
    expect(config.rateLimits.booking.limit).toBe(0);
    expect(config.bookingsPerEmailPerHour).toBe(3);
  });

  it.each(['https://kunde.de/', 'https://kunde.de/buchen', 'kunde.de', 'ftp://kunde.de', '*'])(
    'lehnt den Origin %s ab',
    (origin) => {
      expect(() => loadConfig({ ...validEnv, CORS_ALLOWED_ORIGINS: origin })).toThrow(
        /CORS_ALLOWED_ORIGINS/,
      );
    },
  );

  it('lehnt negative Grenzen ab', () => {
    expect(() => loadConfig({ ...validEnv, RATE_LIMIT_READ: '-1' })).toThrow(/RATE_LIMIT_READ/);
  });

  it('setzt Secure-Cookies in Produktion standardmäßig', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).session.cookieSecure).toBe(true);
    expect(
      loadConfig({ ...validEnv, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }).session
        .cookieSecure,
    ).toBe(false);
    expect(loadConfig({ ...validEnv, SESSION_COOKIE_SECURE: 'true' }).session.cookieSecure).toBe(
      true,
    );
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
