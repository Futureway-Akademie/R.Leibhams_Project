import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppModuleOptions } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { bodyParserErrors, jsonBodyParser } from './security/body-parser.js';
import { publicCors } from './security/cors.js';
import { RouteNotFoundFilter } from './security/not-found.filter.js';

/** Erzeugt die konfigurierte Anwendung. Wird von main.ts und den Integrationstests genutzt. */
export async function createApp(
  config: AppConfig,
  options: AppModuleOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, options), {
    bufferLogs: true,
    // Eigener JSON-Parser (Größenlimit, Fehler ohne Details), siehe unten.
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Reihenfolge: fremde Origins abweisen, bevor der Body gelesen wird.
  app.use(publicCors(config.cors.allowedOrigins));
  app.use(jsonBodyParser());
  app.use(bodyParserErrors);
  app.use(cookieParser());
  app.useGlobalFilters(new RouteNotFoundFilter());
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
  return app;
}
