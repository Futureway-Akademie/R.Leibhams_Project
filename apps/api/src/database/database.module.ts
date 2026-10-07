import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../config/config.js';
import type { AppConfig } from '../config/config.js';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const MONGO_DB = Symbol('MONGO_DB');

const PING_TIMEOUT_MS = 2_000;

@Injectable()
export class DatabaseService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(DatabaseService.name);
  }

  /**
   * Baut die Verbindung beim Start auf. Ein Fehler beendet die API nicht: Der Healthcheck
   * meldet den Zustand, und der Treiber verbindet sich bei der nächsten Operation erneut.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.info({ db: this.db.databaseName }, 'MongoDB verbunden');
    } catch (error) {
      // Nur der Fehlertyp wird geloggt; Treibermeldungen können Verbindungsdetails enthalten.
      this.logger.warn({ errorType: (error as Error).name }, 'MongoDB beim Start nicht erreichbar');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.command({ ping: 1 }, { timeoutMS: PING_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new MongoClient(config.mongodb.uri, {
          appName: 'fw-booking-api',
          serverSelectionTimeoutMS: 5_000,
        }),
    },
    {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, APP_CONFIG],
      useFactory: (client: MongoClient, config: AppConfig) => client.db(config.mongodb.dbName),
    },
    DatabaseService,
  ],
  exports: [MONGO_CLIENT, MONGO_DB, DatabaseService],
})
export class DatabaseModule {}
