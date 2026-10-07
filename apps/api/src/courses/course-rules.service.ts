import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_BOOKING_HORIZON_DAYS,
  addLocalDays,
  eachLocalDate,
  isoWeekdayOf,
  localBoundaryToUtc,
  localToUtc,
  localToday,
} from '@fw-booking/shared';
import type {
  CourseGenerationReport,
  CourseRuleCreate,
  CourseRuleUpdate,
} from '@fw-booking/shared';
import { Db, ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_DB } from '../database/database.module.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { CourseRuleDocument, SessionDocument } from '../database/documents.js';
import { CourseSessionsService } from './course-sessions.service.js';

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

const emptyReport = (): CourseGenerationReport => ({
  created: 0,
  conflicts: [],
  keptWithBookings: [],
});

@Injectable()
export class CourseRulesService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly sessions: CourseSessionsService,
    private readonly availability: AvailabilityService,
  ) {
    this.c = collections(db);
  }

  list(): Promise<CourseRuleDocument[]> {
    return this.c.courseRules.find({}, { sort: { createdAt: 1, _id: 1 } }).toArray();
  }

  async get(id: ObjectId): Promise<CourseRuleDocument> {
    const rule = await this.c.courseRules.findOne({ _id: id });
    if (!rule) throw new NotFoundException('Kursregel nicht gefunden');
    return rule;
  }

  async create(
    input: CourseRuleCreate,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<{ rule: CourseRuleDocument; generation: CourseGenerationReport }> {
    const service = await this.c.services.findOne({ _id: new ObjectId(input.serviceId) });
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    if (service.type !== 'group') {
      throw new BadRequestException('Kursregeln gibt es nur für Gruppenkurse');
    }
    const rule: CourseRuleDocument = {
      _id: new ObjectId(),
      serviceId: service._id,
      weekdays: [...input.weekdays].sort(),
      startTime: input.startTime,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      capacity: input.capacity,
      location: input.location,
      createdAt: now,
      updatedAt: now,
    };
    await this.c.courseRules.insertOne(rule);
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'courseRule.created',
      objectType: 'courseRule',
      objectId: rule._id,
    });
    return { rule, generation: await this.generateForRule(rule, now) };
  }

  /**
   * Ändert eine Regel (docs/domain-rules.md 3.3): Künftige Termine ohne Buchungen werden
   * entfernt und neu erzeugt, Termine mit Buchungen bleiben unverändert und werden gemeldet.
   */
  async update(
    id: ObjectId,
    input: CourseRuleUpdate,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<{ rule: CourseRuleDocument; generation: CourseGenerationReport }> {
    const existing = await this.get(id);
    const set: Partial<CourseRuleDocument> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) (set as Record<string, unknown>)[key] = value;
    }
    if (set.weekdays) set.weekdays = [...set.weekdays].sort();
    const merged = { ...existing, ...set };
    if (merged.validUntil !== null && merged.validFrom > merged.validUntil) {
      throw new BadRequestException('Gültig bis muss am oder nach Gültig ab liegen');
    }

    await this.c.courseRules.updateOne({ _id: id }, { $set: { ...set, updatedAt: now } });
    const kept = await this.clearFutureSessions(id, now);
    const rule = await this.get(id);
    const generation = await this.generateForRule(rule, now);
    generation.keptWithBookings = kept;

    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'courseRule.updated',
      objectType: 'courseRule',
      objectId: id,
      details: { fields: Object.keys(set) },
    });
    return { rule, generation };
  }

  /** Löscht die Regel und ihre künftigen ungebuchten Termine; gebuchte bleiben bestehen. */
  async remove(
    id: ObjectId,
    owner: AuthenticatedOwner,
    now = new Date(),
  ): Promise<{ keptWithBookings: string[] }> {
    await this.get(id);
    const kept = await this.clearFutureSessions(id, now);
    await this.c.courseRules.deleteOne({ _id: id });
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'courseRule.deleted',
      objectType: 'courseRule',
      objectId: id,
    });
    return { keptWithBookings: kept };
  }

  /** Entfernt künftige Termine der Regel ohne Buchungshistorie; liefert die übrigen. */
  private async clearFutureSessions(ruleId: ObjectId, now: Date): Promise<string[]> {
    const future = await this.c.sessions
      .find({ ruleId, startsAt: { $gt: now }, status: { $ne: 'cancelled' } })
      .toArray();
    const booked = new Set(
      (
        await this.c.bookings.distinct('sessionId', {
          sessionId: { $in: future.map((s) => s._id) },
        })
      ).map(String),
    );
    const kept: SessionDocument[] = [];
    for (const session of future) {
      if (booked.has(String(session._id))) kept.push(session);
      else await this.sessions.purgeWithoutHistory(session);
    }
    return kept.map((s) => s.localStart);
  }

  /** Erzeugt fehlende Termine aller Regeln (idempotent). */
  async generateAll(now = new Date()): Promise<void> {
    for (const rule of await this.list()) await this.generateForRule(rule, now);
  }

  /**
   * Erzeugt fehlende Termine einer Regel vom heutigen Tag bis zum Buchungshorizont.
   * Übersprungen werden: vergangene Zeiten, nicht existierende lokale Zeiten (Zeitumstellung),
   * Sperrzeiten und bereits belegte Zeiten (letztere werden als Konflikt gemeldet).
   */
  async generateForRule(
    rule: CourseRuleDocument,
    now = new Date(),
  ): Promise<CourseGenerationReport> {
    const report = emptyReport();
    const service = await this.c.services.findOne({ _id: rule.serviceId });
    if (service?.type !== 'group' || !service.active) return report;

    const timeZone = await this.availability.timeZone();
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    const horizonDays =
      service.bookingRules.horizonDays ??
      settings?.defaultHorizonDays ??
      DEFAULT_BOOKING_HORIZON_DAYS;

    const today = localToday(timeZone, now.toISOString());
    const from = rule.validFrom > today ? rule.validFrom : today;
    const horizonEnd = addLocalDays(today, horizonDays);
    const to =
      rule.validUntil !== null && rule.validUntil < horizonEnd ? rule.validUntil : horizonEnd;
    if (from > to) return report;

    const toMs = (local: string) => Date.parse(localBoundaryToUtc(local, timeZone));
    const closed = (
      await this.c.availabilityExceptions
        .find({
          kind: 'closed',
          start: { $lt: `${addLocalDays(to, 1)}T00:00` },
          end: { $gt: `${from}T00:00` },
        })
        .toArray()
    ).map((e) => ({ start: toMs(e.start), end: toMs(e.end) }));

    const existing = new Set(
      (
        await this.c.sessions
          .find({ ruleId: rule._id }, { projection: { localStart: 1 } })
          .toArray()
      ).map((s) => s.localStart),
    );
    const durationMs = service.durationMinutes * 60_000;

    for (const date of eachLocalDate(from, to)) {
      if (!rule.weekdays.includes(isoWeekdayOf(date))) continue;
      const localStart = `${date}T${rule.startTime}`;
      if (existing.has(localStart)) continue;

      const converted = localToUtc(localStart, timeZone);
      if (!converted.ok) continue;
      const start = Date.parse(converted.utc);
      const end = start + durationMs;
      if (start <= now.getTime()) continue;
      if (closed.some((c) => c.start < end && c.end > start)) continue;

      const result = await this.sessions.insert({
        _id: new ObjectId(),
        serviceId: service._id,
        ruleId: rule._id,
        localStart,
        startsAt: new Date(start),
        endsAt: new Date(end),
        timeZone,
        capacity: rule.capacity ?? service.defaultCapacity,
        bookedCount: 0,
        status: 'scheduled',
        location: rule.location,
        createdAt: now,
        updatedAt: now,
      });
      if (result === 'created') report.created += 1;
      else if (result === 'conflict') report.conflicts.push(localStart);
    }
    return report;
  }
}
