import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import type { DestinationStream } from 'pino';
import { APP_CONFIG } from './config/config.js';
import type { AppConfig } from './config/config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { loggerParams } from './logging/logging.js';

export interface AppModuleOptions {
  /** Ziel für Logs, z. B. in Tests. Standard: stdout. */
  logStream?: DestinationStream;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot(loggerParams(config, options.logStream)),
        DatabaseModule,
        AuthModule,
        CatalogModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
