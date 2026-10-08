// Ansicht und Storno der eigenen Buchung über den Verwaltungslink (docs/domain-rules.md 6).
import { GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SelfServiceBooking } from '@fw-booking/shared';
import { Db, MongoClient, ObjectId } from 'mongodb';
import { recordAudit } from '../common/audit.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { BookingDocument } from '../database/documents.js';
import { bookingConflict } from './booking-errors.js';
import { ActionTokenService } from './action-token.service.js';

const MINUTE_MS = 60_000;
const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

@Injectable()
export class SelfServiceService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly tokens: ActionTokenService,
  ) {
    this.c = collections(db);
  }

  /** Buchung zum Token; unbekannte Tokens ergeben 404, abgelaufene 410. */
  async bookingFor(token: string | undefined, now: Date): Promise<BookingDocument> {
    const resolved = await this.tokens.resolve(token, now);
    if (resolved.state === 'expired') {
      throw new GoneException({
        statusCode: 410,
        message: 'Der Link ist abgelaufen',
        code: 'link_expired',
      });
    }
    if (resolved.state === 'unknown') throw new NotFoundException('Buchung nicht gefunden');
    return resolved.booking;
  }

  /** Letzter Zeitpunkt für Storno und Umbuchung (Angebotsregel, sonst Standard der Installation). */
  async changeDeadline(booking: BookingDocument): Promise<Date> {
    const service = await this.c.services.findOne({ _id: booking.serviceId });
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    const minutes =
      service?.bookingRules.changeDeadlineMinutes ?? settings?.defaultChangeDeadlineMinutes ?? 0;
    return new Date(booking.startsAt.getTime() - minutes * MINUTE_MS);
  }

  /** Ob diese Buchung selbst durch eine Umbuchung entstanden ist (höchstens eine Umbuchung). */
  async isRebookResult(booking: BookingDocument): Promise<boolean> {
    return (
      (await this.c.bookings.countDocuments({ rebookedToBookingId: booking._id }, { limit: 1 })) > 0
    );
  }

  async toView(booking: BookingDocument, now: Date): Promise<SelfServiceBooking> {
    const service = await this.c.services.findOne({ _id: booking.serviceId });
    const session = booking.sessionId
      ? await this.c.sessions.findOne({ _id: booking.sessionId })
      : null;
    const deadline = await this.changeDeadline(booking);
    const changeable = booking.status === 'confirmed' && now <= deadline;
    return {
      type: booking.type,
      serviceTitle: service?.title ?? '',
      participantName: booking.participant.name,
      startsAt: iso(booking.startsAt),
      endsAt: iso(booking.endsAt),
      timeZone: booking.timeZone,
      location: session?.location ?? null,
      status: booking.status,
      changeDeadline: iso(deadline),
      canCancel: changeable,
      canRebook: changeable && !(await this.isRebookResult(booking)),
    };
  }

  /** Reine Ansicht; das Öffnen des Links verändert nichts. */
  async view(token: string | undefined, now = new Date()): Promise<SelfServiceBooking> {
    return this.toView(await this.bookingFor(token, now), now);
  }

  /**
   * Storniert die Buchung genau einmal: Status, Freigabe des Platzes bzw. der Zeit, Entwertung
   * aller Links, Storno-Mail-Auftrag und Audit in einer Transaktion. Ein wiederholter Aufruf
   * ändert nichts und meldet „bereits storniert“.
   */
  async cancel(
    token: string | undefined,
    now = new Date(),
  ): Promise<{ view: SelfServiceBooking; alreadyCancelled: boolean }> {
    const booking = await this.bookingFor(token, now);
    if (booking.status === 'cancelled') {
      return { view: await this.toView(booking, now), alreadyCancelled: true };
    }
    if (booking.status !== 'confirmed') throw bookingConflict('not_cancellable');
    if (now > (await this.changeDeadline(booking))) throw bookingConflict('change_deadline_passed');

    let alreadyCancelled = false;
    await this.client.withSession((tx) =>
      tx.withTransaction(async () => {
        alreadyCancelled = false;
        const changed = await this.c.bookings.updateOne(
          { _id: booking._id, status: 'confirmed' },
          { $set: { status: 'cancelled', updatedAt: now } },
          { session: tx },
        );
        if (changed.modifiedCount === 0) {
          // Gleichzeitiger Storno war schneller: nichts erneut freigeben.
          const current = await this.c.bookings.findOne({ _id: booking._id }, { session: tx });
          if (current?.status === 'cancelled') {
            alreadyCancelled = true;
            return;
          }
          throw bookingConflict('not_cancellable');
        }

        if (booking.type === 'group' && booking.sessionId) {
          await this.c.sessions.updateOne(
            { _id: booking.sessionId, bookedCount: { $gt: 0 } },
            { $inc: { bookedCount: -1 }, $set: { updatedAt: now } },
            { session: tx },
          );
        } else {
          await this.c.resourceOccupancy.deleteMany(
            { refType: 'booking', refId: booking._id },
            { session: tx },
          );
        }
        await this.tokens.invalidateAll(booking._id, 'used', tx);
        await this.c.outboxJobs.insertOne(
          {
            _id: new ObjectId(),
            type: 'booking_cancellation',
            status: 'pending',
            dedupeKey: `booking_cancellation:${booking._id.toHexString()}`,
            bookingId: booking._id,
            dueAt: now,
            attempts: 0,
            leaseUntil: null,
            lastErrorCategory: null,
            createdAt: now,
            updatedAt: now,
          },
          { session: tx },
        );
        await recordAudit(
          this.c.auditEvents,
          {
            actor: { type: 'participant', id: null },
            action: 'booking.cancelled',
            objectType: 'booking',
            objectId: booking._id,
            details: { type: booking.type },
          },
          tx,
        );
      }),
    );

    const updated = await this.c.bookings.findOne({ _id: booking._id });
    return { view: await this.toView(updated ?? booking, now), alreadyCancelled };
  }
}
