// Atomare Buchung (docs/domain-rules.md 5, docs/architecture.md „Doppelbuchungen verhindern“).
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GroupBookingRequest } from '@fw-booking/shared';
import { Db, MongoClient, MongoServerError, ObjectId } from 'mongodb';
import { normalizeEmail } from '../auth/crypto.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type {
  BookingDocument,
  OutboxJobDocument,
  ServiceDocument,
  SettingsDocument,
} from '../database/documents.js';
import { bookingConflict } from './booking-errors.js';

const MINUTE_MS = 60_000;

export interface BookingResult {
  booking: BookingDocument;
  service: ServiceDocument;
  /** true, wenn eine frühere Anfrage mit gleichem Idempotenzschlüssel wiederholt wurde. */
  replayed: boolean;
}

function isDuplicateOn(error: unknown, indexName: string): boolean {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    error.message.includes(`index: ${indexName}`)
  );
}

@Injectable()
export class BookingService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {
    this.c = collections(db);
  }

  /**
   * Bucht einen Kursplatz. In einer Transaktion: Platz nur belegen, wenn der Termin geplant ist
   * und noch Kapazität frei ist; Buchung, Bestätigungsauftrag und Audit-Eintrag anlegen.
   * Schlägt ein Schritt fehl, wird nichts gespeichert.
   */
  async bookGroup(
    request: GroupBookingRequest,
    settings: SettingsDocument,
    now = new Date(),
  ): Promise<BookingResult> {
    const emailKey = normalizeEmail(request.participant.email);

    const previous = await this.c.bookings.findOne({ idempotencyKey: request.idempotencyKey });
    if (previous) return this.replay(previous, request.sessionId, emailKey);

    const sessionId = new ObjectId(request.sessionId);
    const session = await this.c.sessions.findOne({ _id: sessionId });
    if (!session) throw new NotFoundException('Kurstermin nicht gefunden');
    const service = await this.c.services.findOne({ _id: session.serviceId, active: true });
    if (service?.type !== 'group') throw new NotFoundException('Kurstermin nicht gefunden');

    const minLead = service.bookingRules.minLeadMinutes ?? settings.defaultMinLeadMinutes;
    const horizonDays = service.bookingRules.horizonDays ?? settings.defaultHorizonDays;
    const start = session.startsAt.getTime();
    if (
      session.status !== 'scheduled' ||
      start < now.getTime() + minLead * MINUTE_MS ||
      start > now.getTime() + horizonDays * 24 * 60 * MINUTE_MS
    ) {
      throw bookingConflict('not_bookable');
    }

    const booking: BookingDocument = {
      _id: new ObjectId(),
      serviceId: service._id,
      type: 'group',
      sessionId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timeZone: session.timeZone,
      status: 'confirmed',
      participant: request.participant,
      participantEmailKey: emailKey,
      idempotencyKey: request.idempotencyKey,
      privacyAcceptedAt: now,
      rebookedToBookingId: null,
      createdAt: now,
      updatedAt: now,
    };
    const confirmation: OutboxJobDocument = {
      _id: new ObjectId(),
      type: 'booking_confirmation',
      status: 'pending',
      dedupeKey: `booking_confirmation:${booking._id.toHexString()}`,
      bookingId: booking._id,
      dueAt: now,
      attempts: 0,
      leaseUntil: null,
      lastErrorCategory: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.client.withSession((tx) =>
        tx.withTransaction(async () => {
          // Die Schreibbedingung prüft die verbleibende Kapazität unmittelbar.
          const seat = await this.c.sessions.updateOne(
            {
              _id: sessionId,
              status: 'scheduled',
              $expr: { $lt: ['$bookedCount', '$capacity'] },
            },
            { $inc: { bookedCount: 1 }, $set: { updatedAt: now } },
            { session: tx },
          );
          if (seat.matchedCount === 0) {
            const current = await this.c.sessions.findOne({ _id: sessionId }, { session: tx });
            throw bookingConflict(
              current?.status === 'scheduled' ? 'session_full' : 'not_bookable',
            );
          }
          await this.c.bookings.insertOne(booking, { session: tx });
          await this.c.outboxJobs.insertOne(confirmation, { session: tx });
          await recordAudit(
            this.c.auditEvents,
            {
              actor: { type: 'participant', id: null },
              action: 'booking.created',
              objectType: 'booking',
              objectId: booking._id,
              details: { type: 'group', sessionId: sessionId.toHexString() },
            },
            tx,
          );
        }),
      );
    } catch (error) {
      if (isDuplicateOn(error, 'idempotencyKey_unique')) {
        // Gleichzeitige Wiederholung derselben Anfrage: die andere hat gewonnen.
        const winner = await this.c.bookings.findOne({ idempotencyKey: request.idempotencyKey });
        if (winner) return this.replay(winner, request.sessionId, emailKey);
      }
      if (isDuplicateOn(error, 'session_participant_active_unique')) {
        throw bookingConflict('already_booked');
      }
      throw error;
    }

    return { booking, service, replayed: false };
  }

  /** Gleicher Schlüssel und gleiche Anfrage → bestehende Buchung; sonst 409. */
  private async replay(
    previous: BookingDocument,
    sessionId: string,
    emailKey: string,
  ): Promise<BookingResult> {
    const matches =
      previous.type === 'group' &&
      previous.sessionId?.toHexString() === sessionId &&
      previous.participantEmailKey === emailKey;
    if (!matches) throw bookingConflict('idempotency_conflict');
    const service = await this.c.services.findOne({ _id: previous.serviceId });
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    return { booking: previous, service, replayed: true };
  }
}
