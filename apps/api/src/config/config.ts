import { z } from 'zod';

const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?/]+)/;

/** Anzahl Anfragen je Zeitfenster; 0 schaltet die Grenze ab. */
const limitSchema = (fallback: number) =>
  z.coerce.number().int().min(0).max(100_000).default(fallback);

/** Kommagetrennte Liste exakter Origins, z. B. `https://kunde.de,https://www.kunde.de`. */
const originsSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z.string().refine((origin) => {
        try {
          const url = new URL(origin);
          return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
        } catch {
          return false;
        }
      }, 'jeder Eintrag muss ein Origin wie https://kunde.de sein (ohne Pfad und abschließenden Schrägstrich)'),
    ),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z
    .string()
    .regex(
      MONGODB_URI_PATTERN,
      'muss mit mongodb:// oder mongodb+srv:// beginnen und einen Datenbanknamen enthalten',
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Standard: `true` außer in development/test, wo die API über http://localhost läuft. */
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /** Anzahl vertrauenswürdiger Reverse-Proxys vor der API (für die Client-IP). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Origins (WordPress-Domains), die die öffentliche API aus dem Browser nutzen dürfen. */
  CORS_ALLOWED_ORIGINS: originsSchema,
  /** Grenzen je Client-IP: Lesen und Verwaltungslink-Ansicht je Minute, Schreiben je 10 Minuten. */
  RATE_LIMIT_READ: limitSchema(120),
  RATE_LIMIT_BOOKING: limitSchema(10),
  RATE_LIMIT_MANAGE_READ: limitSchema(60),
  RATE_LIMIT_MANAGE_WRITE: limitSchema(10),
  /** Neue Buchungen je E-Mail-Adresse und Stunde. */
  BOOKING_LIMIT_PER_EMAIL: limitSchema(5),
});

export type RateLimitBucket = 'read' | 'booking' | 'manageRead' | 'manageWrite';

export interface RateLimitRule {
  /** Anfragen je Fenster; 0 = unbegrenzt. */
  limit: number;
  windowMs: number;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  mongodb: { uri: string; dbName: string };
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  session: { cookieSecure: boolean };
  trustProxy: number;
  cors: { allowedOrigins: string[] };
  rateLimits: Record<RateLimitBucket, RateLimitRule>;
  /** Neue Buchungen je E-Mail-Adresse und Stunde; 0 = unbegrenzt. */
  bookingsPerEmailPerHour: number;
}

const MINUTE_MS = 60_000;

/** Konfigurationsfehler. Die Meldung nennt nur Variablennamen und Regeln, niemals Werte. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Ungültige Konfiguration:\n${details}`);
  }
  const values = result.data;
  const dbName = decodeURIComponent(MONGODB_URI_PATTERN.exec(values.MONGODB_URI)?.[1] ?? '');
  return {
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    mongodb: { uri: values.MONGODB_URI, dbName },
    logLevel: values.LOG_LEVEL,
    session: {
      cookieSecure:
        values.SESSION_COOKIE_SECURE === undefined
          ? values.NODE_ENV === 'production'
          : values.SESSION_COOKIE_SECURE === 'true',
    },
    trustProxy: values.TRUST_PROXY,
    cors: { allowedOrigins: values.CORS_ALLOWED_ORIGINS },
    rateLimits: {
      read: { limit: values.RATE_LIMIT_READ, windowMs: MINUTE_MS },
      booking: { limit: values.RATE_LIMIT_BOOKING, windowMs: 10 * MINUTE_MS },
      manageRead: { limit: values.RATE_LIMIT_MANAGE_READ, windowMs: MINUTE_MS },
      manageWrite: { limit: values.RATE_LIMIT_MANAGE_WRITE, windowMs: 10 * MINUTE_MS },
    },
    bookingsPerEmailPerHour: values.BOOKING_LIMIT_PER_EMAIL,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
