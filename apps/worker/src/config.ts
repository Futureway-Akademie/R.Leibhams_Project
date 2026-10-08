import { z } from 'zod';

const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?/]+)/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z
    .string()
    .regex(
      MONGODB_URI_PATTERN,
      'muss mit mongodb:// oder mongodb+srv:// beginnen und einen Datenbanknamen enthalten',
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Gleichzeitig bearbeitete Jobs je Worker-Prozess. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Wartezeit zwischen zwei Abfragen, wenn kein Job fällig ist. */
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
});

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  mongodb: { uri: string; dbName: string };
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  concurrency: number;
  pollIntervalMs: number;
}

/** Konfigurationsfehler. Die Meldung nennt nur Variablennamen und Regeln, niemals Werte. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Ungültige Konfiguration:\n${details}`);
  }
  const values = result.data;
  return {
    nodeEnv: values.NODE_ENV,
    mongodb: {
      uri: values.MONGODB_URI,
      dbName: decodeURIComponent(MONGODB_URI_PATTERN.exec(values.MONGODB_URI)?.[1] ?? ''),
    },
    logLevel: values.LOG_LEVEL,
    concurrency: values.WORKER_CONCURRENCY,
    pollIntervalMs: values.WORKER_POLL_INTERVAL_MS,
  };
}
