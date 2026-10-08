// Einstieg des Worker-Prozesses: pnpm --filter @fw-booking/worker dev bzw. start
import { MongoClient } from 'mongodb';
import { ConfigError, loadConfig } from './config.js';
import { createHandlers } from './handlers/index.js';
import { createLogger } from './logger.js';
import { SmtpMailer } from './mail/mailer.js';
import { ReminderScheduler } from './reminders.js';
import { Worker } from './worker.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  const client = new MongoClient(config.mongodb.uri, { appName: 'fw-booking-worker' });
  await client.connect();
  const mailer = new SmtpMailer(config);
  const worker = new Worker(
    client.db(config.mongodb.dbName),
    createHandlers({ mailer, mail: config.mail }),
    { concurrency: config.concurrency, pollIntervalMs: config.pollIntervalMs },
    logger,
  );
  worker.start();
  const reminders = new ReminderScheduler(client.db(config.mongodb.dbName), logger);
  reminders.start();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Beende Worker nach laufenden Jobs');
    void Promise.all([reminders.stop(), worker.stop()])
      .then(() => {
        mailer.close();
        return client.close();
      })
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

void main();
