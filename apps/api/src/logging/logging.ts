import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { AppConfig } from '../config/config.js';

/**
 * Pfade, die in allen Logeinträgen geschwärzt werden. Teilnehmerdaten, Passwörter und Tokens
 * dürfen nicht in normalen Logs landen (docs/architecture.md, Sicherheit).
 */
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-booking-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.participant',
  '*.email',
  '*.phone',
];

/** Query-Strings werden nicht geloggt, weil dort Verwaltungs-Tokens auftauchen könnten. */
function urlWithoutQuery(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}

export function loggerParams(config: AppConfig, stream?: DestinationStream): Params {
  const options = {
    level: config.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: {
      req: (req: IncomingMessage & { id?: unknown }) => ({
        id: req.id,
        method: req.method,
        url: urlWithoutQuery(req.url),
      }),
    },
    autoLogging: { ignore: (req: IncomingMessage) => urlWithoutQuery(req.url) === '/health' },
    ...(config.nodeEnv === 'development' && !stream
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
  return { pinoHttp: stream ? [options, stream] : options };
}
