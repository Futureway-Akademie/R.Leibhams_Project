// Verarbeitungsschleife: beansprucht fällige Jobs, führt den Handler ihres Typs mit Zeitlimit
// aus und schreibt das Ergebnis lease-gebunden zurück. Mehrere Schleifen laufen parallel.
import type { OutboxJobDocument, OutboxJobType } from '@fw-booking/db';
import type { Db } from 'mongodb';
import type { Logger } from 'pino';
import { classify } from './errors.js';
import { JobQueue } from './queue.js';
import type { ClaimedJob, JobQueueOptions } from './queue.js';
import { HANDLER_TIMEOUT_MS } from './retry.js';

export interface JobContext {
  db: Db;
  /** Wird beim Zeitlimit ausgelöst; Handler sollen dann laufende Arbeit abbrechen. */
  signal: AbortSignal;
}

export type JobHandler = (job: OutboxJobDocument, context: JobContext) => Promise<void>;

/** Handler je Jobtyp. Typen ohne Handler werden nicht beansprucht und bleiben liegen. */
export type JobHandlers = Partial<Record<OutboxJobType, JobHandler>>;

export interface WorkerOptions extends JobQueueOptions {
  concurrency: number;
  pollIntervalMs: number;
  handlerTimeoutMs?: number;
}

class HandlerTimeout extends Error {}

export class Worker {
  private readonly queue: JobQueue;
  private readonly types: OutboxJobType[];
  private readonly handlerTimeoutMs: number;
  private loops: Promise<void>[] = [];
  private stopping = false;
  private readonly wakeups = new Set<() => void>();

  constructor(
    private readonly db: Db,
    private readonly handlers: JobHandlers,
    private readonly options: WorkerOptions,
    private readonly logger: Logger,
  ) {
    this.queue = new JobQueue(db, options);
    this.types = Object.keys(handlers) as OutboxJobType[];
    this.handlerTimeoutMs = options.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS;
  }

  start(): void {
    if (this.loops.length > 0) return;
    if (this.types.length === 0) {
      this.logger.warn('Keine Job-Handler registriert; der Worker beansprucht keine Jobs');
    }
    this.stopping = false;
    this.loops = Array.from({ length: this.options.concurrency }, () => this.loop());
    this.logger.info(
      { types: this.types, concurrency: this.options.concurrency },
      'Worker gestartet',
    );
  }

  /** Nimmt keine neuen Jobs mehr an und wartet, bis laufende Jobs abgeschlossen sind. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const wake of this.wakeups) wake();
    await Promise.all(this.loops);
    this.loops = [];
    this.logger.info('Worker beendet');
  }

  /** Bearbeitet höchstens einen fälligen Job. `false`, wenn keiner fällig war. */
  async processNext(): Promise<boolean> {
    const job = await this.queue.claim(this.types);
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let worked = false;
      try {
        worked = await this.processNext();
      } catch (error) {
        // Datenbank nicht erreichbar o. Ä.: nur die Fehlerart loggen, später erneut versuchen.
        this.logger.error(
          { err: { name: (error as Error).name } },
          'Abfrage der Jobs fehlgeschlagen',
        );
      }
      if (!worked) await this.sleep(this.options.pollIntervalMs);
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    const log = this.logger.child({
      jobId: job._id.toHexString(),
      type: job.type,
      attempt: job.attempts,
    });
    if (JobQueue.exhausted(job)) {
      // Mehrfach abgestürzte Verarbeitung: nicht noch einmal ausführen.
      await this.queue.fail(job, 'lease_expired', false);
      log.warn('Job nach wiederholt abgelaufener Lease als fehlgeschlagen markiert');
      return;
    }
    const handler = this.handlers[job.type];
    // Nicht erreichbar: beansprucht werden nur Typen mit Handler.
    if (!handler) return;

    try {
      await this.withTimeout((signal) => handler(job, { db: this.db, signal }));
    } catch (error) {
      const { category, retryable } =
        error instanceof HandlerTimeout
          ? { category: 'timeout', retryable: true }
          : classify(error);
      const outcome = await this.queue.fail(job, category, retryable);
      if (!outcome) {
        log.warn({ category }, 'Lease verloren; Ergebnis verworfen');
      } else if (outcome.status === 'failed') {
        log.error({ category }, 'Job endgültig fehlgeschlagen');
      } else {
        log.warn({ category, retryAt: outcome.dueAt }, 'Job fehlgeschlagen, Wiederholung geplant');
      }
      return;
    }

    if (await this.queue.complete(job)) {
      log.info('Job erledigt');
    } else {
      log.warn('Lease verloren; Ergebnis verworfen');
    }
  }

  private async withTimeout(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Erst als Zeitüberschreitung werten, dann abbrechen: Ein Handler, der beim Abbruch
        // sofort zurückkehrt, darf nicht als erfolgreich gelten.
        reject(new HandlerTimeout());
        controller.abort();
      }, this.handlerTimeoutMs);
    });
    try {
      await Promise.race([run(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Wartet bis zur nächsten Abfrage; `stop()` beendet das Warten sofort. */
  private sleep(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.wakeups.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.wakeups.add(wake);
    });
  }
}
