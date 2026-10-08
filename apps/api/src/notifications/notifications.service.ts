// Fehlgeschlagene Benachrichtigungen für den Owner (task-3-5): Liste mit Kurzübersicht der
// Buchung, erneuter Versuch und Ausblenden. Ausgegeben werden nur freigegebene Felder; der
// Worker speichert ohnehin nur Fehlerkategorien, nie Fehlermeldungen.
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MAX_FAILED_NOTIFICATIONS,
  addLocalDays,
  localBoundaryToUtc,
  toNotificationErrorCategory,
} from '@fw-booking/shared';
import type {
  FailedNotification,
  FailedNotificationsQuery,
  FailedNotificationsResponse,
  NotificationActionResult,
} from '@fw-booking/shared';
import { Db } from 'mongodb';
import type { ObjectId } from 'mongodb';
import type { Filter } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type { OutboxJobDocument } from '../database/documents.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

/** Sichtbare fehlgeschlagene Jobs: endgültig gescheitert und nicht ausgeblendet. */
const VISIBLE_FAILED = { status: 'failed', dismissedAt: { $in: [null] } } as const;

@Injectable()
export class NotificationsService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly availability: AvailabilityService,
  ) {
    this.c = collections(db);
  }

  async listFailed(query: FailedNotificationsQuery): Promise<FailedNotificationsResponse> {
    const filter: Filter<OutboxJobDocument> = { ...VISIBLE_FAILED };
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      const timeZone = await this.availability.timeZone();
      const failedAt: { $gte?: Date; $lt?: Date } = {};
      if (query.from) failedAt.$gte = new Date(localBoundaryToUtc(`${query.from}T00:00`, timeZone));
      if (query.to) {
        failedAt.$lt = new Date(localBoundaryToUtc(`${addLocalDays(query.to, 1)}T00:00`, timeZone));
      }
      filter.failedAt = failedAt;
    }

    const [jobs, total, retryingCount] = await Promise.all([
      this.c.outboxJobs
        .find(filter, { sort: { failedAt: -1, _id: -1 }, limit: MAX_FAILED_NOTIFICATIONS })
        .toArray(),
      this.c.outboxJobs.countDocuments(filter),
      this.c.outboxJobs.countDocuments({
        status: { $in: ['pending', 'processing'] },
        attempts: { $gt: 0 },
        lastErrorCategory: { $ne: null },
      }),
    ]);

    const bookingIds = jobs.flatMap((job) => (job.bookingId ? [job.bookingId] : []));
    const bookings = await this.c.bookings.find({ _id: { $in: bookingIds } }).toArray();
    const services = await this.c.services
      .find({ _id: { $in: bookings.map((b) => b.serviceId) } })
      .toArray();

    const notifications = jobs.map((job): FailedNotification => {
      const booking = job.bookingId ? bookings.find((b) => b._id.equals(job.bookingId)) : null;
      const service = booking ? services.find((s) => s._id.equals(booking.serviceId)) : null;
      return {
        id: job._id.toHexString(),
        type: job.type,
        category: toNotificationErrorCategory(job.lastErrorCategory),
        failedAt: iso(job.failedAt ?? job.updatedAt),
        attempts: job.attempts,
        booking: booking
          ? {
              id: booking._id.toHexString(),
              serviceTitle: service?.title ?? '',
              startsAt: iso(booking.startsAt),
              status: booking.status,
              participant: {
                name: booking.participant.name,
                email: booking.participant.email,
                phone: booking.participant.phone,
              },
            }
          : null,
      };
    });
    return { notifications, total, retryingCount };
  }

  /**
   * Stellt einen fehlgeschlagenen Job erneut zur Verarbeitung (z. B. nach Korrektur der
   * SMTP-Zugangsdaten). Versuche beginnen neu; der Handler prüft den Buchungsstand erneut.
   */
  async retry(
    id: ObjectId,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<NotificationActionResult> {
    const result = await this.c.outboxJobs.updateOne(
      { _id: id, ...VISIBLE_FAILED },
      {
        $set: {
          status: 'pending',
          dueAt: now,
          attempts: 0,
          failedAt: null,
          leaseUntil: null,
          leaseToken: null,
          lastErrorCategory: null,
          updatedAt: now,
        },
      },
    );
    if (result.modifiedCount === 0) {
      const job = await this.c.outboxJobs.findOne({ _id: id });
      if (!job) throw new NotFoundException('Benachrichtigung nicht gefunden');
      if (job.status === 'pending' || job.status === 'processing') {
        return { id: id.toHexString(), status: 'pending', alreadyDone: true };
      }
      throw new ConflictException(
        job.status === 'failed'
          ? 'Ausgeblendete Benachrichtigungen können nicht erneut versendet werden'
          : 'Die Benachrichtigung wurde bereits versendet',
      );
    }
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'notification.retried',
      objectType: 'outboxJob',
      objectId: id,
    });
    return { id: id.toHexString(), status: 'pending', alreadyDone: false };
  }

  /** Blendet einen fehlgeschlagenen Job aus der Liste aus; er bleibt gespeichert. */
  async dismiss(
    id: ObjectId,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<NotificationActionResult> {
    const result = await this.c.outboxJobs.updateOne(
      { _id: id, ...VISIBLE_FAILED },
      { $set: { dismissedAt: now, updatedAt: now } },
    );
    if (result.modifiedCount === 0) {
      const job = await this.c.outboxJobs.findOne({ _id: id });
      if (!job) throw new NotFoundException('Benachrichtigung nicht gefunden');
      if (job.status === 'failed') {
        return { id: id.toHexString(), status: 'failed', alreadyDone: true };
      }
      throw new ConflictException(
        'Nur fehlgeschlagene Benachrichtigungen können ausgeblendet werden',
      );
    }
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'notification.dismissed',
      objectType: 'outboxJob',
      objectId: id,
    });
    return { id: id.toHexString(), status: 'failed', alreadyDone: false };
  }
}
