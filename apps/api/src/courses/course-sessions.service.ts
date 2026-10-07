import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { addLocalDays, localBoundaryToUtc, utcToLocal } from '@fw-booking/shared';
import type { SessionCreate, SessionQuery, SessionUpdate } from '@fw-booking/shared';
import { Db, MongoClient, ObjectId } from 'mongodb';
import type { Filter } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type { SessionDocument } from '../database/documents.js';
import {
  isDuplicateOccurrence,
  isOccupancyConflict,
  occupancyUnits,
  releaseOccupancy,
} from './occupancy.js';

export type InsertResult = 'created' | 'conflict' | 'exists';

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

@Injectable()
export class CourseSessionsService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly availability: AvailabilityService,
  ) {
    this.c = collections(db);
  }

  async list(query: SessionQuery): Promise<SessionDocument[]> {
    const timeZone = await this.availability.timeZone();
    const filter: Filter<SessionDocument> = {};
    const startsAt: { $gte?: Date; $lt?: Date } = {};
    if (query.from) startsAt.$gte = new Date(localBoundaryToUtc(`${query.from}T00:00`, timeZone));
    if (query.to) {
      startsAt.$lt = new Date(localBoundaryToUtc(`${addLocalDays(query.to, 1)}T00:00`, timeZone));
    }
    if (startsAt.$gte || startsAt.$lt) filter.startsAt = startsAt;
    if (query.serviceId) filter.serviceId = new ObjectId(query.serviceId);
    if (query.includeCancelled !== 'true') filter.status = { $ne: 'cancelled' };
    return this.c.sessions.find(filter, { sort: { startsAt: 1, _id: 1 } }).toArray();
  }

  async get(id: ObjectId): Promise<SessionDocument> {
    const session = await this.c.sessions.findOne({ _id: id });
    if (!session) throw new NotFoundException('Kurstermin nicht gefunden');
    return session;
  }

  /**
   * Legt einen Kurstermin samt Belegung der Ressource in einer Transaktion an.
   * Überschneidet er sich mit belegter Zeit, entsteht nichts (`conflict`).
   */
  async insert(doc: SessionDocument): Promise<InsertResult> {
    try {
      await this.client.withSession((session) =>
        session.withTransaction(async () => {
          await this.c.sessions.insertOne(doc, { session });
          await this.c.resourceOccupancy.insertMany(
            occupancyUnits(doc.startsAt, doc.endsAt, 'session', doc._id),
            { session },
          );
        }),
      );
      return 'created';
    } catch (error) {
      if (isOccupancyConflict(error)) return 'conflict';
      if (isDuplicateOccurrence(error)) return 'exists';
      throw error;
    }
  }

  async createManual(
    input: SessionCreate,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<SessionDocument> {
    const service = await this.c.services.findOne({ _id: new ObjectId(input.serviceId) });
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    if (service.type !== 'group') {
      throw new BadRequestException('Kurstermine gibt es nur für Gruppenkurse');
    }
    if (!service.active) throw new ConflictException('Das Angebot ist deaktiviert');

    const startsAt = new Date(input.startsAt);
    if (startsAt <= now) throw new BadRequestException('Der Kurstermin muss in der Zukunft liegen');

    const timeZone = await this.availability.timeZone();
    const doc: SessionDocument = {
      _id: new ObjectId(),
      serviceId: service._id,
      ruleId: null,
      localStart: utcToLocal(input.startsAt, timeZone).dateTime,
      startsAt,
      endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000),
      timeZone,
      capacity: input.capacity ?? service.defaultCapacity,
      bookedCount: 0,
      status: 'scheduled',
      location: input.location,
      createdAt: now,
      updatedAt: now,
    };
    if ((await this.insert(doc)) !== 'created') {
      throw new ConflictException('Der Zeitraum ist bereits belegt');
    }
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'session.created',
      objectType: 'session',
      objectId: doc._id,
    });
    return doc;
  }

  async hasBookingHistory(sessionId: ObjectId): Promise<boolean> {
    return (await this.c.bookings.countDocuments({ sessionId }, { limit: 1 })) > 0;
  }

  /**
   * Ändert Kapazität, Ort, Sperrstatus und – nur ohne Buchungen – die Uhrzeit.
   * Die Kapazität darf die Zahl gebuchter Plätze nicht unterschreiten.
   */
  async update(
    id: ObjectId,
    input: SessionUpdate,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<SessionDocument> {
    const existing = await this.get(id);
    if (existing.status === 'cancelled') {
      throw new ConflictException('Ein abgesagter Kurstermin kann nicht geändert werden');
    }

    const set: Partial<SessionDocument> = {};
    if (input.capacity !== undefined) set.capacity = input.capacity;
    if (input.location !== undefined) set.location = input.location;
    if (input.status !== undefined) set.status = input.status;

    const move =
      input.startsAt !== undefined && Date.parse(input.startsAt) !== existing.startsAt.getTime();
    if (move && input.startsAt) {
      if (await this.hasBookingHistory(id)) {
        throw new ConflictException(
          'Kurstermine mit Buchungen können nicht verschoben werden; bitte absagen und neu anlegen',
        );
      }
      const startsAt = new Date(input.startsAt);
      if (startsAt <= now) {
        throw new BadRequestException('Der Kurstermin muss in der Zukunft liegen');
      }
      set.startsAt = startsAt;
      set.endsAt = new Date(
        startsAt.getTime() + existing.endsAt.getTime() - existing.startsAt.getTime(),
      );
      // Regeltermine behalten ihren Wiederholungsschlüssel, sonst würden sie neu erzeugt.
      if (existing.ruleId === null) {
        set.localStart = utcToLocal(input.startsAt, existing.timeZone).dateTime;
      }
    }

    const capacity = set.capacity ?? existing.capacity;
    let updated: SessionDocument;
    try {
      updated = await this.client.withSession((session) =>
        session.withTransaction(async () => {
          if (move && set.startsAt && set.endsAt) {
            await releaseOccupancy(this.c, 'session', id, session);
            await this.c.resourceOccupancy.insertMany(
              occupancyUnits(set.startsAt, set.endsAt, 'session', id),
              { session },
            );
          }
          const doc = await this.c.sessions.findOneAndUpdate(
            { _id: id, status: { $ne: 'cancelled' }, bookedCount: { $lte: capacity } },
            { $set: { ...set, updatedAt: now } },
            { returnDocument: 'after', session },
          );
          if (!doc) {
            throw new ConflictException(
              'Die Kapazität darf die gebuchten Plätze nicht unterschreiten',
            );
          }
          return doc;
        }),
      );
    } catch (error) {
      if (isOccupancyConflict(error)) {
        throw new ConflictException('Der Zeitraum ist bereits belegt');
      }
      throw error;
    }

    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'session.updated',
      objectType: 'session',
      objectId: id,
      details: { fields: Object.keys(set) },
    });
    return updated;
  }

  /**
   * Entfernt einen Kurstermin ohne jede Buchungshistorie. Regeltermine werden als abgesagt
   * markiert (damit die Erzeugung sie nicht neu anlegt), manuelle Termine gelöscht.
   */
  async remove(id: ObjectId, owner: AuthenticatedOwner): Promise<void> {
    const existing = await this.get(id);
    if (await this.hasBookingHistory(id)) {
      throw new ConflictException('Kurstermine mit Buchungen werden abgesagt, nicht gelöscht');
    }
    await this.removeWithoutHistory(existing);
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'session.removed',
      objectType: 'session',
      objectId: id,
    });
  }

  /** Gemeinsamer Teil für das Entfernen einzelner Termine und das Aufräumen bei Regeländerungen. */
  async removeWithoutHistory(existing: SessionDocument): Promise<void> {
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        await releaseOccupancy(this.c, 'session', existing._id, session);
        if (existing.ruleId) {
          await this.c.sessions.updateOne(
            { _id: existing._id },
            { $set: { status: 'cancelled', updatedAt: new Date() } },
            { session },
          );
        } else {
          await this.c.sessions.deleteOne({ _id: existing._id }, { session });
        }
      }),
    );
  }

  /** Löscht künftige ungebuchte Regeltermine physisch (bei Regeländerung/-löschung). */
  async purgeWithoutHistory(existing: SessionDocument): Promise<void> {
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        await releaseOccupancy(this.c, 'session', existing._id, session);
        await this.c.sessions.deleteOne({ _id: existing._id }, { session });
      }),
    );
  }
}
