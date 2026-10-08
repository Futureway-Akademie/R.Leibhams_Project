import type { AppConfig } from '../config/config.js';

export { TEST_MONGODB_VERSION, startReplSet } from '@fw-booking/db/testing';

export function testConfig(mongoUri: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const url = new URL(mongoUri);
  url.pathname = '/fw_booking_test';
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    mongodb: { uri: url.toString(), dbName: 'fw_booking_test' },
    logLevel: 'silent',
    session: { cookieSecure: false },
    trustProxy: 0,
    cors: { allowedOrigins: [] },
    // Grenzen in Tests standardmäßig aus; die Missbrauchsschutz-Tests setzen sie gezielt.
    rateLimits: {
      read: { limit: 0, windowMs: 60_000 },
      booking: { limit: 0, windowMs: 600_000 },
      manageRead: { limit: 0, windowMs: 60_000 },
      manageWrite: { limit: 0, windowMs: 600_000 },
    },
    bookingsPerEmailPerHour: 0,
    ...overrides,
  };
}
