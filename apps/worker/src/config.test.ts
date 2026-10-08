import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  MONGODB_URI: 'mongodb://localhost:27017/fw_booking?replicaSet=rs0',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM_ADDRESS: 'termine@friseur.test',
  BUSINESS_NAME: 'Friseur Muster',
  MANAGE_PAGE_URL: 'https://friseur.test/termin-verwalten',
};

describe('loadConfig', () => {
  it('liest Standardwerte und den Datenbanknamen', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'development',
      mongodb: { uri: validEnv.MONGODB_URI, dbName: 'fw_booking' },
      logLevel: 'info',
      concurrency: 4,
      pollIntervalMs: 5_000,
      smtp: { host: '127.0.0.1', port: 1025, secure: false, requireTls: false, auth: null },
      mail: {
        fromAddress: 'termine@friseur.test',
        replyTo: null,
        businessName: 'Friseur Muster',
        businessPhone: null,
        managePageUrl: 'https://friseur.test/termin-verwalten',
      },
    });
  });

  it('übernimmt gesetzte Werte', () => {
    expect(
      loadConfig({
        ...validEnv,
        WORKER_CONCURRENCY: '8',
        WORKER_POLL_INTERVAL_MS: '1000',
        SMTP_SECURE: 'true',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'geheim',
        MAIL_REPLY_TO: 'info@friseur.test',
        BUSINESS_PHONE: '030 123456',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({
      concurrency: 8,
      pollIntervalMs: 1000,
      smtp: { secure: true, requireTls: true, auth: { user: 'mailer', pass: 'geheim' } },
      mail: { replyTo: 'info@friseur.test', businessPhone: '030 123456' },
    });
  });

  it.each([
    [{ ...validEnv, MONGODB_URI: undefined }, /MONGODB_URI/],
    [{ ...validEnv, WORKER_CONCURRENCY: '0' }, /WORKER_CONCURRENCY/],
    [{ ...validEnv, WORKER_POLL_INTERVAL_MS: '10' }, /WORKER_POLL_INTERVAL_MS/],
    [{ ...validEnv, SMTP_HOST: undefined }, /SMTP_HOST/],
    [{ ...validEnv, MAIL_FROM_ADDRESS: 'keine-adresse' }, /MAIL_FROM_ADDRESS/],
    [{ ...validEnv, BUSINESS_NAME: ' ' }, /BUSINESS_NAME/],
    [{ ...validEnv, MANAGE_PAGE_URL: 'ftp://friseur.test' }, /MANAGE_PAGE_URL/],
    [{ ...validEnv, MANAGE_PAGE_URL: 'https://friseur.test/verwalten#t=' }, /MANAGE_PAGE_URL/],
    [{ ...validEnv, NODE_ENV: 'production', MANAGE_PAGE_URL: 'http://friseur.test' }, /https/],
    [{ ...validEnv, SMTP_USER: 'mailer' }, /SMTP_USER/],
  ])('lehnt ungültige Konfiguration ab (%#)', (env, pattern) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(pattern);
  });

  it('nennt in Fehlern keine Werte', () => {
    let message = '';
    try {
      loadConfig({ ...validEnv, MONGODB_URI: 'postgres://user:geheim@host/db', SMTP_USER: 'x' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/MONGODB_URI/);
    expect(message).not.toContain('geheim');
  });
});
