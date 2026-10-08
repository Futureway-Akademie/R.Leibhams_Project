// Planer für Erinnerungen (task-3-4): legt für bestätigte Buchungen, deren Erinnerungszeitpunkt
// erreicht ist, einen Auftrag `booking_reminder` an. Die Fachregeln (docs/domain-rules.md 9):
// Vorlauf aus den Installations-Einstellungen; keine Erinnerung für Buchungen, die erst
// innerhalb dieses Fensters entstanden sind, und keine für bereits begonnene Termine.
// Mehrere Worker dürfen gleichzeitig planen: der eindeutige `dedupeKey` verhindert Doppelungen.
import { DEFAULT_REMINDER_LEAD_MINUTES } from '@fw-booking/shared';
import { SETTINGS_ID, collections } from '@fw-booking/db';
import type { OutboxJobDocument } from '@fw-booking/db';
import { MongoBulkWriteError, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { Logger } from 'pino';

const MINUTE_MS = 60_000;

/** Abstand der Planungsläufe; bestimmt die Genauigkeit des Versandzeitpunkts. */
export const REMINDER_SCAN_INTERVAL_MS = MINUTE_MS;

export const reminderDedupeKey = (bookingId: ObjectId) =>
  `booking_reminder:${bookingId.toHexString()}`;

export class ReminderScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly intervalMs = REMINDER_SCAN_INTERVAL_MS,
  ) {}

  /** Legt fällige Erinnerungsaufträge an. Liefert die Anzahl neu angelegter Aufträge. */
  async scan(now = new Date()): Promise<number> {
    const c = collections(this.db);
    const settings = await c.settings.findOne({ _id: SETTINGS_ID });
    const leadMs = (settings?.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES) * MINUTE_MS;

    const candidates = await c.bookings
      .find(
        {
          status: 'confirmed',
          startsAt: { $gt: now, $lte: new Date(now.getTime() + leadMs) },
          // Nur Buchungen, die vor Beginn des Erinnerungsfensters entstanden sind.
          $expr: { $lte: ['$createdAt', { $subtract: ['$startsAt', leadMs] }] },
        },
        { projection: { _id: 1, startsAt: 1 } },
      )
      .toArray();
    if (candidates.length === 0) return 0;

    const existing = new Set(
      (
        await c.outboxJobs
          .find(
            { dedupeKey: { $in: candidates.map((b) => reminderDedupeKey(b._id)) } },
            { projection: { dedupeKey: 1 } },
          )
          .toArray()
      ).map((job) => job.dedupeKey),
    );
    const jobs: OutboxJobDocument[] = candidates
      .filter((b) => !existing.has(reminderDedupeKey(b._id)))
      .map((b) => ({
        _id: new ObjectId(),
        type: 'booking_reminder',
        status: 'pending',
        dedupeKey: reminderDedupeKey(b._id),
        bookingId: b._id,
        scheduledFor: b.startsAt,
        dueAt: now,
        attempts: 0,
        leaseUntil: null,
        lastErrorCategory: null,
        createdAt: now,
        updatedAt: now,
      }));
    if (jobs.length === 0) return 0;

    try {
      return (await c.outboxJobs.insertMany(jobs, { ordered: false })).insertedCount;
    } catch (error) {
      // Gleichzeitig planender Worker war schneller: doppelte Aufträge sind abgewiesen.
      const writeErrors = error instanceof MongoBulkWriteError ? [error.writeErrors].flat() : [];
      if (writeErrors.length > 0 && writeErrors.every((e) => e.code === 11000)) {
        return (error as MongoBulkWriteError).insertedCount;
      }
      throw error;
    }
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.running = this.scan().then(
        (created) => {
          if (created > 0) this.logger.info({ created }, 'Erinnerungen geplant');
        },
        (error: unknown) => {
          this.logger.error(
            { err: { name: (error as Error).name } },
            'Planung der Erinnerungen fehlgeschlagen',
          );
        },
      );
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
