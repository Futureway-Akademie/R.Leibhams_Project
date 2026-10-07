// Kommandozeilen-Einstieg für die Provisionierung: pnpm --filter @fw-booking/api db:migrate
import { MongoClient } from 'mongodb';
import { ConfigError, loadConfig } from '../config/config.js';
import { MigrationError, runMigrations } from './migrations/runner.js';

async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const client = new MongoClient(config.mongodb.uri, {
    appName: 'fw-booking-migrate',
    serverSelectionTimeoutMS: 5_000,
  });
  try {
    await client.connect();
    const result = await runMigrations(client.db(config.mongodb.dbName));
    console.log(`Datenbank: ${config.mongodb.dbName}`);
    console.log(`Angewendet: ${result.applied.join(', ') || '–'}`);
    console.log(`Bereits vorhanden: ${result.alreadyApplied.join(', ') || '–'}`);
    return 0;
  } catch (error) {
    // Treibermeldungen können Verbindungsdetails enthalten; nur eigene Meldungen ausgeben.
    console.error(
      error instanceof MigrationError
        ? error.message
        : `Migration fehlgeschlagen (${(error as Error).name})`,
    );
    return 1;
  } finally {
    await client.close();
  }
}

process.exitCode = await main();
