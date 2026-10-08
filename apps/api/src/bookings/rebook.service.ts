// Umbuchung über den Verwaltungslink (docs/domain-rules.md 6).
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { addLocalDays, localBoundaryToUtc, utcToLocal } from '@fw-booking/shared';
import type {
  AvailableDatesQuery,
  SelfServiceBooking,
  SelfServiceRebookRequest,
} from '@fw-booking/shared';
import { Db, MongoClient, MongoServerError, ObjectId } from 'mongodb';
import type { ClientSession } from 'mongodb';
import { SlotService } from '../availability/slot.service.js';
import type { Slot } from '../availability/slot.service.js';
import { recordAudit } from '../common/audit.js';
import { isOccupancyConflict, occupancyUnits } from '../courses/occupancy.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { DEFAULT_RESOURCE_ID, SETTINGS_ID, collections } from '../database/documents.js';
import type {
  BookingDocument,
  ServiceDocument,
  SessionDocument,
  SettingsDocument,
} from '../database/documents.js';
import { bookingConflict } from './booking-errors.js';
import { SelfServiceService } from './self-service.service.js';

const MINUTE_MS = 60_000;

export interface RebookResult {
  view: SelfServiceBooking;
  /** true, wenn die Anfrage einer bereits erfolgten Umbuchung entspricht (Doppelklick). */
  alreadyRebooked: boolean;
}

@Injectable()
export class RebookService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly selfService: SelfServiceService,
    private readonly slots: SlotService,
  ) {
    this.c = collections(db);
  }

  private async context(token: string | undefined, now: Date) {
    const booking = await this.selfService.bookingFor(token, now);
    const service = await this.c.services.findOne({ _id: booking.serviceId });
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    if (!service || !settings) throw bookingConflict('not_bookable');
    return { booking, service, settings };
  }

  /** Mögliche neue Startzeiten eines Einzeltermins; die eigene Zeit gilt als frei. */
  async slotOptions(
    token: string | undefined,
    date: string,
    now = new Date(),
  ): Promise<{ serviceId: string; timeZone: string; slots: Slot[] }> {
    const { booking, service, settings } = await this.context(token, now);
    if (booking.type !== 'single') throw new BadRequestException('Nur für Einzeltermine');
    const slots = await this.slots.slotsForDate(service, date, now, {
      ignoreBookingId: booking._id,
    });
    return {
      serviceId: service._id.toHexString(),
      timeZone: settings.timeZone,
      slots: slots.filter((s) => s.startsAt.getTime() !== booking.startsAt.getTime()),
    };
  }

  /** Mögliche andere Kurstermine desselben Kurses mit freien Plätzen (auch ausgebuchte). */
  async sessionOptions(
    token: string | undefined,
    range: AvailableDatesQuery,
    now = new Date(),
  ): Promise<{ serviceId: string; timeZone: string; sessions: SessionDocument[] }> {
    const { booking, service, settings } = await this.context(token, now);
    if (booking.type !== 'group') throw new BadRequestException('Nur für Gruppenkurse');
    const { earliest, latest } = this.limits(service, settings, now);
    const from = Date.parse(localBoundaryToUtc(`${range.from}T00:00`, settings.timeZone));
    const to = Date.parse(
      localBoundaryToUtc(`${addLocalDays(range.to, 1)}T00:00`, settings.timeZone),
    );
    const sessions = await this.c.sessions
      .find(
        {
          serviceId: service._id,
          status: 'scheduled',
          _id: { $ne: booking.sessionId ?? new ObjectId() },
          startsAt: {
            $gte: new Date(Math.max(from, earliest)),
            $lt: new Date(to),
            $lte: new Date(latest),
          },
        },
        { sort: { startsAt: 1 } },
      )
      .toArray();
    return { serviceId: service._id.toHexString(), timeZone: settings.timeZone, sessions };
  }

  private async replayIfSameTarget(
    bookingId: ObjectId,
    target: { startsAt: Date } | { sessionId: string },
    now: Date,
  ): Promise<RebookResult | null> {
    const current = await this.c.bookings.findOne({ _id: bookingId });
    if (current?.status !== 'rebooked' || !current.rebookedToBookingId) return null;
    const next = await this.c.bookings.findOne({ _id: current.rebookedToBookingId });
    if (!next) return null;
    const same =
      'startsAt' in target
        ? next.startsAt.getTime() === target.startsAt.getTime()
        : next.sessionId?.toHexString() === target.sessionId;
    return same ? { view: await this.selfService.toView(next, now), alreadyRebooked: true } : null;
  }

  private limits(service: ServiceDocument, settings: SettingsDocument, now: Date) {
    const minLead = service.bookingRules.minLeadMinutes ?? settings.defaultMinLeadMinutes;
    const horizonDays = service.bookingRules.horizonDays ?? settings.defaultHorizonDays;
    return {
      earliest: now.getTime() + minLead * MINUTE_MS,
      latest: now.getTime() + horizonDays * 24 * 60 * MINUTE_MS,
    };
  }

  /**
   * Bucht auf einen anderen Termin desselben Angebots um. In einer Transaktion: neuen Platz bzw.
   * neue Zeit reservieren, alten Platz bzw. alte Zeit freigeben, neue Buchung anlegen, alte als
   * `rebooked` markieren, Links übertragen, Umbuchungsmail-Auftrag und Audit. Ist das Ziel
   * belegt, bleibt die ursprüngliche Buchung unverändert. Höchstens eine Umbuchung je Buchung.
   */
  async rebook(
    token: string | undefined,
    request: SelfServiceRebookRequest,
    now = new Date(),
  ): Promise<RebookResult> {
    const { booking, service, settings } = await this.context(token, now);
    const target =
      request.type === 'single'
        ? { startsAt: new Date(request.startsAt) }
        : { sessionId: request.sessionId };
    try {
      return await this.perform(booking, service, settings, request, target, now);
    } catch (error) {
      // Gleichzeitiger Doppelklick: Eine andere Anfrage hat bereits auf dasselbe Ziel umgebucht
      // (auch wenn das erst nach unserer Vorprüfung sichtbar wurde).
      const replay = await this.replayIfSameTarget(booking._id, target, now);
      if (replay) return replay;
      throw error;
    }
  }

  private async perform(
    booking: BookingDocument,
    service: ServiceDocument,
    settings: SettingsDocument,
    request: SelfServiceRebookRequest,
    target: { startsAt: Date } | { sessionId: string },
    now: Date,
  ): Promise<RebookResult> {
    if (request.type !== booking.type) {
      throw new BadRequestException('Die Terminart passt nicht zur Buchung');
    }

    const isCurrent =
      request.type === 'single'
        ? booking.startsAt.getTime() === Date.parse(request.startsAt)
        : booking.sessionId?.toHexString() === request.sessionId;

    if (await this.selfService.isRebookResult(booking)) {
      // Doppelklick auf dieselbe Umbuchung: bestehendes Ergebnis zurückgeben.
      if (isCurrent && booking.status === 'confirmed') {
        return { view: await this.selfService.toView(booking, now), alreadyRebooked: true };
      }
      throw bookingConflict('rebook_not_allowed');
    }
    if (booking.status !== 'confirmed') throw bookingConflict('rebook_not_allowed');
    if (now > (await this.selfService.changeDeadline(booking))) {
      throw bookingConflict('change_deadline_passed');
    }
    if (isCurrent) throw new BadRequestException('Das ist bereits der gebuchte Termin');
    if (!service.active) throw bookingConflict('not_bookable');

    const fresh: BookingDocument = {
      _id: new ObjectId(),
      serviceId: booking.serviceId,
      type: booking.type,
      sessionId: null,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
      status: 'confirmed',
      participant: booking.participant,
      participantEmailKey: booking.participantEmailKey,
      idempotencyKey: `rebook-${booking._id.toHexString()}`,
      privacyAcceptedAt: booking.privacyAcceptedAt,
      rebookedToBookingId: null,
      createdAt: now,
      updatedAt: now,
    };

    let reserve: (tx: ClientSession) => Promise<void>;
    if (service.type === 'single' && 'startsAt' in target) {
      const startsAt = target.startsAt;
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);
      const date = utcToLocal(startsAt.toISOString(), settings.timeZone).date;
      const offered = await this.slots.slotsForDate(service, date, now, {
        ignoreBookingId: booking._id,
      });
      if (!offered.some((s) => s.startsAt.getTime() === startsAt.getTime())) {
        const occupied = await this.c.resourceOccupancy.countDocuments(
          {
            resourceId: DEFAULT_RESOURCE_ID,
            unitStart: { $gte: startsAt, $lt: endsAt },
            $nor: [{ refType: 'booking', refId: booking._id }],
          },
          { limit: 1 },
        );
        throw bookingConflict(occupied > 0 ? 'slot_taken' : 'not_bookable');
      }
      Object.assign(fresh, { startsAt, endsAt, timeZone: settings.timeZone });
      reserve = async (tx) => {
        // Alte Zeit zuerst freigeben, damit ein Verschieben mit Überschneidung möglich ist.
        await this.c.resourceOccupancy.deleteMany(
          { refType: 'booking', refId: booking._id },
          { session: tx },
        );
        await this.c.resourceOccupancy.insertMany(
          occupancyUnits(startsAt, endsAt, 'booking', fresh._id),
          { session: tx },
        );
      };
    } else if ('sessionId' in target) {
      const sessionId = new ObjectId(target.sessionId);
      const session = await this.c.sessions.findOne({ _id: sessionId });
      const { earliest, latest } = this.limits(service, settings, now);
      if (
        !session?.serviceId.equals(service._id) ||
        session.status !== 'scheduled' ||
        session.startsAt.getTime() < earliest ||
        session.startsAt.getTime() > latest
      ) {
        throw bookingConflict('not_bookable');
      }
      Object.assign(fresh, {
        sessionId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        timeZone: session.timeZone,
      });
      const oldSessionId = booking.sessionId;
      reserve = async (tx) => {
        const seat = await this.c.sessions.updateOne(
          { _id: sessionId, status: 'scheduled', $expr: { $lt: ['$bookedCount', '$capacity'] } },
          { $inc: { bookedCount: 1 }, $set: { updatedAt: now } },
          { session: tx },
        );
        if (seat.matchedCount === 0) {
          const current = await this.c.sessions.findOne({ _id: sessionId }, { session: tx });
          throw bookingConflict(current?.status === 'scheduled' ? 'session_full' : 'not_bookable');
        }
        if (oldSessionId) {
          await this.c.sessions.updateOne(
            { _id: oldSessionId, bookedCount: { $gt: 0 } },
            { $inc: { bookedCount: -1 }, $set: { updatedAt: now } },
            { session: tx },
          );
        }
      };
    } else {
      throw new BadRequestException('Ungültige Umbuchung');
    }

    try {
      await this.client.withSession((tx) =>
        tx.withTransaction(async () => {
          // Zuerst die alte Buchung als umgebucht markieren: schützt vor doppelter Umbuchung.
          const marked = await this.c.bookings.updateOne(
            { _id: booking._id, status: 'confirmed' },
            { $set: { status: 'rebooked', rebookedToBookingId: fresh._id, updatedAt: now } },
            { session: tx },
          );
          if (marked.modifiedCount === 0) throw bookingConflict('rebook_not_allowed');
          await reserve(tx);
          await this.c.bookings.insertOne(fresh, { session: tx });
          // Bisherige Links gelten für die neue Buchung weiter (bis zu deren Ende).
          await this.c.actionTokens.updateMany(
            { bookingId: booking._id, status: 'active' },
            { $set: { bookingId: fresh._id, expiresAt: fresh.endsAt } },
            { session: tx },
          );
          await this.c.outboxJobs.insertOne(
            {
              _id: new ObjectId(),
              type: 'booking_rebooked',
              status: 'pending',
              dedupeKey: `booking_rebooked:${fresh._id.toHexString()}`,
              bookingId: fresh._id,
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
              action: 'booking.rebooked',
              objectType: 'booking',
              objectId: booking._id,
              details: { type: booking.type, newBookingId: fresh._id.toHexString() },
            },
            tx,
          );
        }),
      );
    } catch (error) {
      if (isOccupancyConflict(error)) throw bookingConflict('slot_taken');
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        error.message.includes('index: session_participant_active_unique')
      ) {
        throw bookingConflict('already_booked');
      }
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        error.message.includes('index: idempotencyKey_unique')
      ) {
        throw bookingConflict('rebook_not_allowed');
      }
      throw error;
    }

    return { view: await this.selfService.toView(fresh, now), alreadyRebooked: false };
  }
}
