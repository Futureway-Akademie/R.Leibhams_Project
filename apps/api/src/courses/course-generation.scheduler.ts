import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CourseRulesService } from './course-rules.service.js';

export const GENERATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Schiebt Kurstermine nach, während der Buchungshorizont weiterwandert: beim Start und alle
 * 6 Stunden. Die Erzeugung ist idempotent; mehrere API-Instanzen sind unkritisch.
 */
@Injectable()
export class CourseGenerationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly rules: CourseRulesService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(CourseGenerationScheduler.name);
  }

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), GENERATION_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  run(): Promise<void> {
    this.running ??= this.rules
      .generateAll()
      .catch((error: unknown) => {
        this.logger.warn(
          { errorType: (error as Error).name },
          'Erzeugung von Kursterminen fehlgeschlagen',
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
}
