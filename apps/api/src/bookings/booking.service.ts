// Atomare Buchung (docs/domain-rules.md 5, docs/architecture.md „Doppelbuchungen verhindern“).
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { utcToLocal } from '@fw-booking/shared';
import type { GroupBookingRequest, SingleBookingRequest } from '@fw-booking/shared';
import { Db, MongoClient, MongoServerError, ObjectId } from 'mongodb';
import type { ClientSession } from 'mongodb';
import { normalizeEmail } from '../auth/crypto.js';
import { SlotService } from '../availability/slot.service.js';
import { recordAudit } from '../common/audit.js';
import { APP_CONFIG } from '../config/config.js';
import type { AppConfig } from '../config/config.js';
import { isOccupancyConflict, occupancyUnits } from '../courses/occupancy.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { DEFAULT_RESOURCE_ID, collections } from '../database/documents.js';
import type {
  BookingDocument,
  OutboxJobDocument,
  ServiceDocument,
  SettingsDocument,
} from '../database/documents.js';
import { bookingConflict, bookingLimit } from './booking-errors.js';

const MINUTE_MS = 60_000;

export interface BookingResult {
  booking: BookingDocument;
  service: ServiceDocument;
  /** true, wenn eine frühere Anfrage mit gleichem Idempotenzschlüssel wiederholt wurde. */
  replayed: boolean;
}

/** Ob eine frühere Buchung zur aktuellen Anfrage mit demselben Idempotenzschlüssel passt. */
type ReplayMatcher = (previous: BookingDocument) => boolean;

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
    private readonly slots: SlotService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.c = collections(db);
  }

  /**
   * Bucht einen Kursplatz: Platz nur belegen, wenn der Termin geplant ist und noch Kapazität
   * frei ist (Schreibbedingung), zusammen mit Buchung, Bestätigungsauftrag und Audit.
   */
  async bookGroup(
    request: GroupBookingRequest,
    settings: SettingsDocument,
    now = new Date(),
  ): Promise<BookingResult> {
    const emailKey = normalizeEmail(request.participant.email);
    const matches: ReplayMatcher = (previous) =>
      previous.type === 'group' &&
      previous.sessionId?.toHexString() === request.sessionId &&
      previous.participantEmailKey === emailKey;

    const previous = await this.c.bookings.findOne({ idempotencyKey: request.idempotencyKey });
    if (previous) return this.replay(previous, matches);
    await this.assertEmailQuota(emailKey, now);

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

    const booking = this.newBooking(request, service, emailKey, now, {
      type: 'group',
      sessionId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timeZone: session.timeZone,
    });

    return this.persist(booking, service, matches, now, async (tx) => {
      const seat = await this.c.sessions.updateOne(
        { _id: sessionId, status: 'scheduled', $expr: { $lt: ['$bookedCount', '$capacity'] } },
        { $inc: { bookedCount: 1 }, $set: { updatedAt: now } },
        { session: tx },
      );
      if (seat.matchedCount === 0) {
        const current = await this.c.sessions.findOne({ _id: sessionId }, { session: tx });
        throw bookingConflict(current?.status === 'scheduled' ? 'session_full' : 'not_bookable');
      }
    });
  }

  /**
   * Bucht einen Einzeltermin zu einer berechneten Startzeit. Die Belegung der Ressource für die
   * Dauer des Termins entsteht in derselben Transaktion; der eindeutige Index auf die
   * 5-Minuten-Einheiten verhindert Überschneidungen auch bei gleichzeitigen Anfragen.
   */
  async bookSingle(
    request: SingleBookingRequest,
    settings: SettingsDocument,
    now = new Date(),
  ): Promise<BookingResult> {
    const emailKey = normalizeEmail(request.participant.email);
    const startsAt = new Date(request.startsAt);
    const matches: ReplayMatcher = (previous) =>
      previous.type === 'single' &&
      previous.serviceId.toHexString() === request.serviceId &&
      previous.startsAt.getTime() === startsAt.getTime() &&
      previous.participantEmailKey === emailKey;

    const previous = await this.c.bookings.findOne({ idempotencyKey: request.idempotencyKey });
    if (previous) return this.replay(previous, matches);
    await this.assertEmailQuota(emailKey, now);

    const service = await this.c.services.findOne({
      _id: new ObjectId(request.serviceId),
      active: true,
    });
    if (service?.type !== 'single') throw new NotFoundException('Angebot nicht gefunden');
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);

    // Nur berechnete Startzeiten sind buchbar (Raster, Öffnungszeit, Sperrzeiten, Fristen).
    const date = utcToLocal(request.startsAt, settings.timeZone).date;
    const offered = await this.slots.slotsForDate(service, date, now);
    if (!offered.some((slot) => slot.startsAt.getTime() === startsAt.getTime())) {
      const occupied = await this.c.resourceOccupancy.countDocuments(
        { resourceId: DEFAULT_RESOURCE_ID, unitStart: { $gte: startsAt, $lt: endsAt } },
        { limit: 1 },
      );
      throw bookingConflict(occupied > 0 ? 'slot_taken' : 'not_bookable');
    }

    const booking = this.newBooking(request, service, emailKey, now, {
      type: 'single',
      sessionId: null,
      startsAt,
      endsAt,
      timeZone: settings.timeZone,
    });

    return this.persist(booking, service, matches, now, async (tx) => {
      await this.c.resourceOccupancy.insertMany(
        occupancyUnits(startsAt, endsAt, 'booking', booking._id),
        { session: tx },
      );
    });
  }

  /**
   * Begrenzt neue Buchungen je E-Mail-Adresse und Stunde (Missbrauchsschutz). Wiederholungen mit
   * gleichem Idempotenzschlüssel und durch Umbuchung entstandene Buchungen zählen nicht. Bei
   * gleichzeitigen Anfragen derselben Adresse kann die Grenze knapp überschritten werden.
   */
  private async assertEmailQuota(emailKey: string, now: Date): Promise<void> {
    const limit = this.config.bookingsPerEmailPerHour;
    if (limit === 0) return;
    const recent = await this.c.bookings.countDocuments(
      {
        participantEmailKey: emailKey,
        createdAt: { $gt: new Date(now.getTime() - 60 * MINUTE_MS) },
        idempotencyKey: { $not: /^rebook-/ },
      },
      { limit },
    );
    if (recent >= limit) throw bookingLimit('too_many_bookings');
  }

  private newBooking(
    request: GroupBookingRequest | SingleBookingRequest,
    service: ServiceDocument,
    emailKey: string,
    now: Date,
    slot: Pick<BookingDocument, 'type' | 'sessionId' | 'startsAt' | 'endsAt' | 'timeZone'>,
  ): BookingDocument {
    return {
      _id: new ObjectId(),
      serviceId: service._id,
      ...slot,
      status: 'confirmed',
      participant: request.participant,
      participantEmailKey: emailKey,
      idempotencyKey: request.idempotencyKey,
      privacyAcceptedAt: now,
      rebookedToBookingId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Gemeinsamer Abschluss beider Terminarten in einer Transaktion: Platz bzw. Zeit reservieren,
   * Buchung, Bestätigungsauftrag und Audit-Eintrag anlegen. Schlägt ein Schritt fehl,
   * wird nichts gespeichert.
   */
  private async persist(
    booking: BookingDocument,
    service: ServiceDocument,
    matches: ReplayMatcher,
    now: Date,
    reserve: (tx: ClientSession) => Promise<void>,
  ): Promise<BookingResult> {
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
          await reserve(tx);
          await this.c.bookings.insertOne(booking, { session: tx });
          await this.c.outboxJobs.insertOne(confirmation, { session: tx });
          await recordAudit(
            this.c.auditEvents,
            {
              actor: { type: 'participant', id: null },
              action: 'booking.created',
              objectType: 'booking',
              objectId: booking._id,
              details: {
                type: booking.type,
                serviceId: booking.serviceId.toHexString(),
                ...(booking.sessionId ? { sessionId: booking.sessionId.toHexString() } : {}),
              },
            },
            tx,
          );
        }),
      );
    } catch (error) {
      if (isDuplicateOn(error, 'idempotencyKey_unique')) {
        // Gleichzeitige Wiederholung derselben Anfrage: die andere hat gewonnen.
        const winner = await this.c.bookings.findOne({ idempotencyKey: booking.idempotencyKey });
        if (winner) return this.replay(winner, matches);
      }
      if (isDuplicateOn(error, 'session_participant_active_unique')) {
        throw bookingConflict('already_booked');
      }
      if (isOccupancyConflict(error)) throw bookingConflict('slot_taken');
      throw error;
    }

    return { booking, service, replayed: false };
  }

  /** Gleicher Schlüssel und gleiche Anfrage → bestehende Buchung; sonst 409. */
  private async replay(previous: BookingDocument, matches: ReplayMatcher): Promise<BookingResult> {
    if (!matches(previous)) throw bookingConflict('idempotency_conflict');
    const service = await this.c.services.findOne({ _id: previous.serviceId });
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    return { booking: previous, service, replayed: true };
  }
}
