import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  addLocalDays,
  isoWeekdayOf,
  localBoundaryToUtc,
  localToday,
} from '@fw-booking/shared';
import type {
  AvailabilityExceptionCreate,
  AvailabilityExceptionQuery,
  WeeklyOpeningHours,
} from '@fw-booking/shared';
import { Db, MongoClient, ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { AvailabilityExceptionDocument, OpeningHoursDocument } from '../database/documents.js';
import { clipIntervals, mergeIntervals, subtractIntervals } from './intervals.js';
import type { Interval } from './intervals.js';

export interface UtcWindow {
  start: Date;
  end: Date;
}

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

/** `HH:MM` an einem lokalen Datum als `YYYY-MM-DDTHH:MM`; `24:00` ist Mitternacht des Folgetags. */
function localDateTime(date: string, time: string): string {
  return time === '24:00' ? `${addLocalDays(date, 1)}T00:00` : `${date}T${time}`;
}

@Injectable()
export class AvailabilityService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {
    this.c = collections(db);
  }

  /** Zeitzone der Installation; wird bei der Einrichtung festgelegt, nicht vom Owner. */
  async timeZone(): Promise<string> {
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    return settings?.timeZone ?? DEFAULT_TIME_ZONE;
  }

  async getOpeningHours(): Promise<WeeklyOpeningHours> {
    const days = await this.c.openingHours.find({}, { sort: { weekday: 1 } }).toArray();
    return days.map((d) => ({ weekday: d.weekday, windows: d.windows }));
  }

  /** Ersetzt den gesamten Wochenplan; nicht aufgeführte Wochentage sind danach geschlossen. */
  async replaceOpeningHours(
    days: WeeklyOpeningHours,
    owner: AuthenticatedOwner,
  ): Promise<WeeklyOpeningHours> {
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        await this.c.openingHours.deleteMany({}, { session });
        const docs: OpeningHoursDocument[] = days.map((d) => ({
          _id: new ObjectId(),
          weekday: d.weekday,
          windows: [...d.windows].sort((a, b) => a.start.localeCompare(b.start)),
        }));
        if (docs.length > 0) await this.c.openingHours.insertMany(docs, { session });
        await recordAudit(
          this.c.auditEvents,
          {
            actor: ownerActor(owner),
            action: 'openingHours.replaced',
            objectType: 'openingHours',
            objectId: 'week',
            details: { weekdays: docs.map((d) => d.weekday).sort() },
          },
          session,
        );
      }),
    );
    return this.getOpeningHours();
  }

  /** Ausnahmen, die den Zeitraum berühren; ohne `from` ab dem heutigen lokalen Datum. */
  async listExceptions(
    query: AvailabilityExceptionQuery,
  ): Promise<AvailabilityExceptionDocument[]> {
    const from = query.from ?? localToday(await this.timeZone());
    const filter: Record<string, unknown> = { end: { $gt: `${from}T00:00` } };
    if (query.to) filter.start = { $lt: `${addLocalDays(query.to, 1)}T00:00` };
    return this.c.availabilityExceptions.find(filter, { sort: { start: 1, _id: 1 } }).toArray();
  }

  async createException(
    input: AvailabilityExceptionCreate,
    owner: AuthenticatedOwner,
  ): Promise<{ exception: AvailabilityExceptionDocument; conflictingBookings: number }> {
    const exception: AvailabilityExceptionDocument = {
      _id: new ObjectId(),
      kind: input.kind,
      start: input.start,
      end: input.end,
      note: input.note,
      createdAt: new Date(),
    };
    await this.c.availabilityExceptions.insertOne(exception);
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'availabilityException.created',
      objectType: 'availabilityException',
      objectId: exception._id,
      details: { kind: exception.kind },
    });

    // Sperrzeiten sagen bestehende Buchungen nicht ab; der Owner erhält einen Hinweis.
    let conflictingBookings = 0;
    if (exception.kind === 'closed') {
      const timeZone = await this.timeZone();
      conflictingBookings = await this.c.bookings.countDocuments({
        status: 'confirmed',
        startsAt: { $lt: new Date(localBoundaryToUtc(exception.end, timeZone)) },
        endsAt: { $gt: new Date(localBoundaryToUtc(exception.start, timeZone)) },
      });
    }
    return { exception, conflictingBookings };
  }

  async deleteException(id: ObjectId, owner: AuthenticatedOwner): Promise<void> {
    const result = await this.c.availabilityExceptions.deleteOne({ _id: id });
    if (result.deletedCount === 0) throw new NotFoundException('Ausnahme nicht gefunden');
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'availabilityException.deleted',
      objectType: 'availabilityException',
      objectId: id,
    });
  }

  /**
   * Geöffnete Zeitfenster eines lokalen Kalendertags in UTC:
   * (Wochenplan ∪ zusätzliche Öffnungen) − Sperrzeiten, begrenzt auf den Tag.
   * Sperrzeiten haben Vorrang vor zusätzlichen Öffnungen.
   */
  async openWindowsForDate(date: string): Promise<UtcWindow[]> {
    const timeZone = await this.timeZone();
    const toMs = (local: string) => Date.parse(localBoundaryToUtc(local, timeZone));
    const day: Interval = {
      start: toMs(`${date}T00:00`),
      end: toMs(`${addLocalDays(date, 1)}T00:00`),
    };

    const weekly = await this.c.openingHours.findOne({ weekday: isoWeekdayOf(date) });
    const regular = (weekly?.windows ?? []).map((w) => ({
      start: toMs(localDateTime(date, w.start)),
      end: toMs(localDateTime(date, w.end)),
    }));

    const exceptions = await this.c.availabilityExceptions
      .find({ start: { $lt: `${addLocalDays(date, 1)}T00:00` }, end: { $gt: `${date}T00:00` } })
      .toArray();
    const asInterval = (e: AvailabilityExceptionDocument) => ({
      start: toMs(e.start),
      end: toMs(e.end),
    });
    const extra = exceptions.filter((e) => e.kind === 'extra_opening').map(asInterval);
    const closed = exceptions.filter((e) => e.kind === 'closed').map(asInterval);

    const open = subtractIntervals(mergeIntervals([...regular, ...extra]), closed);
    return clipIntervals(open, day).map((i) => ({
      start: new Date(i.start),
      end: new Date(i.end),
    }));
  }
}
