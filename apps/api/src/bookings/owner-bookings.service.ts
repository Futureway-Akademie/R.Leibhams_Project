// Buchungsübersicht, Teilnehmerlisten und Absagen durch den Owner (docs/domain-rules.md 7).
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addLocalDays, localBoundaryToUtc, localToday } from '@fw-booking/shared';
import type { BookingQuery } from '@fw-booking/shared';
import { Db, MongoClient, ObjectId } from 'mongodb';
import type { ClientSession, Filter } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { recordAudit } from '../common/audit.js';
import { releaseOccupancy } from '../courses/occupancy.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type { BookingDocument, OutboxJobDocument, SessionDocument } from '../database/documents.js';

/** Standardzeitraum der Buchungsübersicht ohne Angabe von `to`. */
const DEFAULT_LIST_DAYS = 31;

type OwnerCancelErrorCode = 'not_cancellable' | 'appointment_ended';

const MESSAGES: Record<OwnerCancelErrorCode, string> = {
  not_cancellable: 'Diese Buchung ist nicht mehr aktiv und kann nicht abgesagt werden',
  appointment_ended: 'Der Termin ist bereits vorbei und kann nicht mehr abgesagt werden',
};

function cancelConflict(code: OwnerCancelErrorCode): ConflictException {
  return new ConflictException({ statusCode: 409, message: MESSAGES[code], code });
}

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

/** Leere Begründung gilt als keine Begründung. */
const normalizeReason = (reason: string | null) => (reason ? reason : null);

function ownerCancellationJob(bookingId: ObjectId, now: Date): OutboxJobDocument {
  return {
    _id: new ObjectId(),
    type: 'owner_cancellation',
    status: 'pending',
    dedupeKey: `owner_cancellation:${bookingId.toHexString()}`,
    bookingId,
    dueAt: now,
    attempts: 0,
    leaseUntil: null,
    lastErrorCategory: null,
    createdAt: now,
    updatedAt: now,
  };
}

@Injectable()
export class OwnerBookingsService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly availability: AvailabilityService,
  ) {
    this.c = collections(db);
  }

  /** Buchungen beider Terminarten im Zeitraum (lokale Tage, Standard: ab heute 31 Tage). */
  async list(query: BookingQuery): Promise<BookingDocument[]> {
    const timeZone = await this.availability.timeZone();
    const from = query.from ?? localToday(timeZone);
    const to = query.to ?? addLocalDays(from, DEFAULT_LIST_DAYS - 1);
    const filter: Filter<BookingDocument> = {
      startsAt: {
        $gte: new Date(localBoundaryToUtc(`${from}T00:00`, timeZone)),
        $lt: new Date(localBoundaryToUtc(`${addLocalDays(to, 1)}T00:00`, timeZone)),
      },
    };
    if (query.serviceId) filter.serviceId = new ObjectId(query.serviceId);
    if (query.sessionId) filter.sessionId = new ObjectId(query.sessionId);
    if (query.status) filter.status = query.status;
    return this.c.bookings.find(filter, { sort: { startsAt: 1, createdAt: 1, _id: 1 } }).toArray();
  }

  async get(id: ObjectId): Promise<BookingDocument> {
    const booking = await this.c.bookings.findOne({ _id: id });
    if (!booking) throw new NotFoundException('Buchung nicht gefunden');
    return booking;
  }

  /** Kurstermin mit allen Buchungen (jeder Status), älteste zuerst. */
  async participants(
    sessionId: ObjectId,
  ): Promise<{ session: SessionDocument; bookings: BookingDocument[] }> {
    const session = await this.c.sessions.findOne({ _id: sessionId });
    if (!session) throw new NotFoundException('Kurstermin nicht gefunden');
    const bookings = await this.c.bookings
      .find({ sessionId }, { sort: { createdAt: 1, _id: 1 } })
      .toArray();
    return { session, bookings };
  }

  /**
   * Sagt eine einzelne Buchung genau einmal ab: Status `cancelled_by_owner`, Freigabe von
   * Kursplatz bzw. Zeit, Entwertung aller Links, Absage-Mail-Auftrag und Audit in einer
   * Transaktion. Eine bereits vom Owner abgesagte Buchung bleibt unverändert.
   */
  async cancelBooking(
    id: ObjectId,
    reason: string | null,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<{ booking: BookingDocument; alreadyCancelled: boolean }> {
    let alreadyCancelled = false;
    await this.client.withSession((tx) =>
      tx.withTransaction(async () => {
        alreadyCancelled = false;
        const booking = await this.c.bookings.findOne({ _id: id }, { session: tx });
        if (!booking) throw new NotFoundException('Buchung nicht gefunden');
        if (booking.status === 'cancelled_by_owner') {
          alreadyCancelled = true;
          return;
        }
        if (booking.status !== 'confirmed') throw cancelConflict('not_cancellable');
        if (booking.endsAt <= now) throw cancelConflict('appointment_ended');

        const changed = await this.c.bookings.updateOne(
          { _id: id, status: 'confirmed' },
          {
            $set: {
              status: 'cancelled_by_owner',
              ownerCancellationReason: normalizeReason(reason),
              updatedAt: now,
            },
          },
          { session: tx },
        );
        // Gleichzeitige Änderungen führen zu einem Schreibkonflikt und Wiederholung; dies ist
        // nur eine zusätzliche Absicherung.
        if (changed.modifiedCount === 0) throw cancelConflict('not_cancellable');

        if (booking.type === 'group' && booking.sessionId) {
          await this.c.sessions.updateOne(
            { _id: booking.sessionId, bookedCount: { $gt: 0 } },
            { $inc: { bookedCount: -1 }, $set: { updatedAt: now } },
            { session: tx },
          );
        } else {
          await releaseOccupancy(this.c, 'booking', id, tx);
        }
        await this.finishCancellations([booking], owner, now, tx);
      }),
    );
    return { booking: await this.get(id), alreadyCancelled };
  }

  /**
   * Sagt einen Kurstermin ab: Termin `cancelled`, alle bestätigten Buchungen
   * `cancelled_by_owner`, Freigabe der Ressource, Entwertung der Links, je Buchung ein
   * Absage-Mail-Auftrag sowie Audit – alles in einer Transaktion. Nicht umkehrbar.
   */
  async cancelSession(
    id: ObjectId,
    reason: string | null,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<{ session: SessionDocument; cancelledBookings: number; alreadyCancelled: boolean }> {
    let alreadyCancelled = false;
    let cancelledBookings = 0;
    await this.client.withSession((tx) =>
      tx.withTransaction(async () => {
        alreadyCancelled = false;
        cancelledBookings = 0;
        const session = await this.c.sessions.findOne({ _id: id }, { session: tx });
        if (!session) throw new NotFoundException('Kurstermin nicht gefunden');
        if (session.status === 'cancelled') {
          alreadyCancelled = true;
          return;
        }
        if (session.endsAt <= now) throw cancelConflict('appointment_ended');

        // Gleichzeitige Buchungen und Stornos schreiben ebenfalls in den Termin und kollidieren
        // deshalb mit dieser Transaktion (Wiederholung), statt unbemerkt dazwischenzukommen.
        await this.c.sessions.updateOne(
          { _id: id, status: { $ne: 'cancelled' } },
          {
            $set: {
              status: 'cancelled',
              bookedCount: 0,
              cancellationReason: normalizeReason(reason),
              updatedAt: now,
            },
          },
          { session: tx },
        );
        await releaseOccupancy(this.c, 'session', id, tx);

        const bookings = await this.c.bookings
          .find({ sessionId: id, status: 'confirmed' }, { session: tx })
          .toArray();
        if (bookings.length > 0) {
          await this.c.bookings.updateMany(
            { _id: { $in: bookings.map((b) => b._id) }, status: 'confirmed' },
            {
              $set: {
                status: 'cancelled_by_owner',
                ownerCancellationReason: normalizeReason(reason),
                updatedAt: now,
              },
            },
            { session: tx },
          );
          await this.finishCancellations(bookings, owner, now, tx);
        }
        cancelledBookings = bookings.length;

        await recordAudit(
          this.c.auditEvents,
          {
            actor: ownerActor(owner),
            action: 'session.cancelled',
            objectType: 'session',
            objectId: id,
            details: {
              cancelledBookings: bookings.length,
              withReason: normalizeReason(reason) !== null,
            },
          },
          tx,
        );
      }),
    );
    const session = await this.c.sessions.findOne({ _id: id });
    if (!session) throw new NotFoundException('Kurstermin nicht gefunden');
    return { session, cancelledBookings, alreadyCancelled };
  }

  /** Gemeinsamer Abschluss je abgesagter Buchung: Links entwerten, Mail-Auftrag, Audit. */
  private async finishCancellations(
    bookings: BookingDocument[],
    owner: AuthenticatedOwner,
    now: Date,
    tx: ClientSession,
  ): Promise<void> {
    const ids = bookings.map((b) => b._id);
    await this.c.actionTokens.updateMany(
      { bookingId: { $in: ids }, status: 'active' },
      { $set: { status: 'revoked' } },
      { session: tx },
    );
    await this.c.outboxJobs.insertMany(
      ids.map((bookingId) => ownerCancellationJob(bookingId, now)),
      { session: tx },
    );
    // Die Begründung kann personenbezogene Angaben enthalten und gehört nicht ins Audit-Log.
    await this.c.auditEvents.insertMany(
      bookings.map((booking) => ({
        _id: new ObjectId(),
        at: now,
        actor: ownerActor(owner),
        action: 'booking.cancelled_by_owner',
        objectType: 'booking',
        objectId: booking._id,
        details: {
          type: booking.type,
          sessionId: booking.sessionId?.toHexString() ?? null,
        },
      })),
      { session: tx },
    );
  }
}
