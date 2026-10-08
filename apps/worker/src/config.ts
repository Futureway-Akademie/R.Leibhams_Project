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

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** `true` für TLS ab Verbindungsbeginn (meist Port 465); sonst STARTTLS, wenn angeboten. */
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  /** Absenderadresse; als Anzeigename dient BUSINESS_NAME. */
  MAIL_FROM_ADDRESS: z.email(),
  MAIL_REPLY_TO: z.email().optional(),
  BUSINESS_NAME: z.string().trim().min(1).max(100),
  BUSINESS_PHONE: z.string().trim().min(1).max(40).optional(),
  /** Seite mit dem Widget, die die Selbstverwaltung anzeigt; Link: MANAGE_PAGE_URL#t=TOKEN. */
  MANAGE_PAGE_URL: z.url({ protocol: /^https?$/ }),
});

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  mongodb: { uri: string; dbName: string };
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  concurrency: number;
  pollIntervalMs: number;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    /** In Produktion muss die Verbindung verschlüsselt sein (STARTTLS oder TLS). */
    requireTls: boolean;
    auth: { user: string; pass: string } | null;
  };
  mail: {
    fromAddress: string;
    replyTo: string | null;
    businessName: string;
    businessPhone: string | null;
    managePageUrl: string;
  };
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
  const problems: string[] = [];
  if ((values.SMTP_USER === undefined) !== (values.SMTP_PASSWORD === undefined)) {
    problems.push('- SMTP_USER/SMTP_PASSWORD: entweder beide oder keines setzen');
  }
  const manageUrl = new URL(values.MANAGE_PAGE_URL);
  if (manageUrl.hash) problems.push('- MANAGE_PAGE_URL: ohne #-Anteil angeben');
  if (values.NODE_ENV === 'production' && manageUrl.protocol !== 'https:') {
    problems.push('- MANAGE_PAGE_URL: in Produktion nur https');
  }
  if (problems.length > 0) {
    throw new ConfigError(`Ungültige Konfiguration:\n${problems.join('\n')}`);
  }
  return {
    nodeEnv: values.NODE_ENV,
    mongodb: {
      uri: values.MONGODB_URI,
      dbName: decodeURIComponent(MONGODB_URI_PATTERN.exec(values.MONGODB_URI)?.[1] ?? ''),
    },
    logLevel: values.LOG_LEVEL,
    concurrency: values.WORKER_CONCURRENCY,
    pollIntervalMs: values.WORKER_POLL_INTERVAL_MS,
    smtp: {
      host: values.SMTP_HOST,
      port: values.SMTP_PORT,
      secure: values.SMTP_SECURE === 'true',
      requireTls: values.NODE_ENV === 'production',
      auth:
        values.SMTP_USER && values.SMTP_PASSWORD
          ? { user: values.SMTP_USER, pass: values.SMTP_PASSWORD }
          : null,
    },
    mail: {
      fromAddress: values.MAIL_FROM_ADDRESS,
      replyTo: values.MAIL_REPLY_TO ?? null,
      businessName: values.BUSINESS_NAME,
      businessPhone: values.BUSINESS_PHONE ?? null,
      managePageUrl: values.MANAGE_PAGE_URL,
    },
  };
}
