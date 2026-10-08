// Zugriff auf `outboxJobs` mit zeitlich begrenzten Leases. Jede Statusänderung nach der
// Beanspruchung ist an das Lease-Token gebunden: Ein Worker, dessen Lease abgelaufen und neu
// vergeben ist, kann das Ergebnis des neuen Inhabers nicht überschreiben.
import { randomBytes } from 'node:crypto';
import { collections } from '@fw-booking/db';
import type { OutboxJobDocument, OutboxJobType } from '@fw-booking/db';
import type { Db } from 'mongodb';
import { LEASE_MS, MAX_ATTEMPTS, retryDelayMs } from './retry.js';

/** Ein beanspruchter Job mit gültigem Lease-Token. */
export type ClaimedJob = OutboxJobDocument & { leaseToken: string; leaseUntil: Date };

export interface FailureOutcome {
  status: 'pending' | 'failed';
  /** Nächster Versuch bei `pending`. */
  dueAt?: Date;
}

export interface JobQueueOptions {
  leaseMs?: number;
  random?: () => number;
}

export class JobQueue {
  private readonly c;
  private readonly leaseMs: number;
  private readonly random: () => number;

  constructor(db: Db, options: JobQueueOptions = {}) {
    this.c = collections(db);
    this.leaseMs = options.leaseMs ?? LEASE_MS;
    this.random = options.random ?? Math.random;
  }

  /**
   * Beansprucht atomar den ältesten fälligen Job der angegebenen Typen: entweder `pending` mit
   * erreichter Fälligkeit oder `processing` mit abgelaufener Lease (abgestürzter Worker).
   */
  async claim(types: readonly OutboxJobType[], now = new Date()): Promise<ClaimedJob | null> {
    if (types.length === 0) return null;
    const leaseToken = randomBytes(16).toString('hex');
    const leaseUntil = new Date(now.getTime() + this.leaseMs);
    const job = await this.c.outboxJobs.findOneAndUpdate(
      {
        type: { $in: [...types] },
        $or: [
          { status: 'pending', dueAt: { $lte: now } },
          { status: 'processing', leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: { status: 'processing', leaseUntil, leaseToken, updatedAt: now },
        $inc: { attempts: 1 },
      },
      { sort: { dueAt: 1, _id: 1 }, returnDocument: 'after' },
    );
    return job ? { ...job, leaseToken, leaseUntil } : null;
  }

  /**
   * Schließt den Job ab (versendet oder bewusst übersprungen). `false`, wenn die Lease nicht mehr
   * diesem Worker gehört.
   */
  async complete(
    job: ClaimedJob,
    now = new Date(),
    outcome: 'sent' | 'skipped' = 'sent',
  ): Promise<boolean> {
    const update = await this.c.outboxJobs.updateOne(
      { _id: job._id, status: 'processing', leaseToken: job.leaseToken },
      {
        $set: {
          status: 'sent',
          result: outcome,
          completedAt: now,
          leaseUntil: null,
          leaseToken: null,
          lastErrorCategory: null,
          updatedAt: now,
        },
      },
    );
    return update.modifiedCount === 1;
  }

  /**
   * Hält einen Fehlschlag fest: bei vorübergehenden Fehlern Wiederholung mit Backoff, nach
   * `MAX_ATTEMPTS` Versuchen oder bei dauerhaften Fehlern endgültig `failed`. `null`, wenn die
   * Lease nicht mehr diesem Worker gehört.
   */
  async fail(
    job: ClaimedJob,
    category: string,
    retryable: boolean,
    now = new Date(),
  ): Promise<FailureOutcome | null> {
    const delay = retryable ? retryDelayMs(job.attempts, this.random) : null;
    const outcome: FailureOutcome =
      delay === null
        ? { status: 'failed' }
        : { status: 'pending', dueAt: new Date(now.getTime() + delay) };
    const result = await this.c.outboxJobs.updateOne(
      { _id: job._id, status: 'processing', leaseToken: job.leaseToken },
      {
        $set: {
          status: outcome.status,
          ...(outcome.dueAt ? { dueAt: outcome.dueAt } : { failedAt: now }),
          leaseUntil: null,
          leaseToken: null,
          lastErrorCategory: category,
          updatedAt: now,
        },
      },
    );
    return result.modifiedCount === 1 ? outcome : null;
  }

  /** Ob ein Job bereits alle Versuche verbraucht hat (z. B. nach wiederholten Abstürzen). */
  static exhausted(job: ClaimedJob): boolean {
    return job.attempts > MAX_ATTEMPTS;
  }
}
