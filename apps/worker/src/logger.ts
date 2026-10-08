import { pino } from 'pino';
import type { DestinationStream, Logger } from 'pino';
import type { WorkerConfig } from './config.js';

/** Teilnehmerdaten und Zugangsdaten dürfen nicht in Logs landen. */
export const REDACTED_PATHS = ['*.password', '*.token', '*.participant', '*.email', '*.phone'];

export function createLogger(config: WorkerConfig, stream?: DestinationStream): Logger {
  const options = {
    name: 'worker',
    level: config.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(config.nodeEnv === 'development' && !stream
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
  return stream ? pino(options, stream) : pino(options);
}
