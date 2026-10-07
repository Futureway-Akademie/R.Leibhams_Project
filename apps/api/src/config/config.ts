import { z } from 'zod';

const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?/]+)/;

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
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  mongodb: { uri: string; dbName: string };
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

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
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
