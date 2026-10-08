// Freie Slots für Einzeltermine (docs/domain-rules.md, Abschnitte 2.3, 4, 5.3 und 8).
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_BOOKING_HORIZON_DAYS,
  DEFAULT_MIN_LEAD_MINUTES,
  OCCUPANCY_UNIT_MINUTES,
  addLocalDays,
  addLocalMinutes,
  eachLocalDate,
  localBoundaryToUtc,
  localToUtc,
  utcToLocal,
} from '@fw-booking/shared';
import { Db } from 'mongodb';
import type { ObjectId } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { DEFAULT_RESOURCE_ID, SETTINGS_ID, collections } from '../database/documents.js';
import type { ServiceDocument, SingleServiceDocument } from '../database/documents.js';
import { AvailabilityService } from './availability.service.js';

export interface SlotOptions {
  /** Belegung dieser Buchung als frei behandeln (Umbuchung mit Überschneidung der eigenen Zeit). */
  ignoreBookingId?: ObjectId;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

const MINUTE_MS = 60_000;
const UNIT_MS = OCCUPANCY_UNIT_MINUTES * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Schutz vor Endlosschleifen: ein Tag hat höchstens 25 Stunden = 300 Fünf-Minuten-Schritte. */
const MAX_CANDIDATES_PER_WINDOW = 300;

@Injectable()
export class SlotService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly availability: AvailabilityService,
  ) {
    this.c = collections(db);
  }

  private async limits(service: SingleServiceDocument, now: Date) {
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    const minLead =
      service.bookingRules.minLeadMinutes ??
      settings?.defaultMinLeadMinutes ??
      DEFAULT_MIN_LEAD_MINUTES;
    const horizonDays =
      service.bookingRules.horizonDays ??
      settings?.defaultHorizonDays ??
      DEFAULT_BOOKING_HORIZON_DAYS;
    return {
      earliest: now.getTime() + minLead * MINUTE_MS,
      latest: now.getTime() + horizonDays * DAY_MS,
    };
  }

  /**
   * Freie Slots eines lokalen Tages. Liefert nichts für Gruppenkurse und deaktivierte Angebote.
   * Die Liste ist unverbindlich; verbindlich ist erst die atomare Prüfung beim Buchen.
   */
  async slotsForDate(
    service: ServiceDocument,
    date: string,
    now = new Date(),
    options: SlotOptions = {},
  ): Promise<Slot[]> {
    if (service.type !== 'single' || !service.active) return [];

    const timeZone = await this.availability.timeZone();
    const { earliest, latest } = await this.limits(service, now);
    const dayStart = Date.parse(localBoundaryToUtc(`${date}T00:00`, timeZone));
    const dayEnd = Date.parse(localBoundaryToUtc(`${addLocalDays(date, 1)}T00:00`, timeZone));
    if (dayEnd <= earliest || dayStart > latest) return [];

    const windows = await this.availability.openWindowsForDate(date);
    if (windows.length === 0) return [];

    // Die Dauer enthält einen eventuellen Puffer bereits; ein Termin belegt genau seine Dauer.
    const durationMs = service.durationMinutes * MINUTE_MS;
    const occupied = await this.occupiedUnits(
      dayStart,
      dayEnd + durationMs,
      options.ignoreBookingId,
    );

    const slots = new Map<number, Slot>();
    for (const window of windows) {
      const windowStart = window.start.getTime();
      const windowEnd = window.end.getTime();
      const localStart = utcToLocal(window.start.toISOString(), timeZone).dateTime;
      const localEnd = utcToLocal(window.end.toISOString(), timeZone).dateTime;

      for (let k = 0; k < MAX_CANDIDATES_PER_WINDOW; k++) {
        // Jede Startzeit im 5-Minuten-Raster (lokale Zeit) ab Fensterbeginn; übersprungene
        // Zeiten entfallen, doppelte ergeben das erste Vorkommen (keine doppelten Slots).
        const local = addLocalMinutes(localStart, k * OCCUPANCY_UNIT_MINUTES);
        if (local >= localEnd && k > 0) break;
        const converted = localToUtc(local, timeZone);
        if (!converted.ok) continue;

        const start = Date.parse(converted.utc);
        if (start < windowStart) continue;
        if (start + durationMs > windowEnd) {
          if (start >= windowEnd) break;
          continue;
        }
        if (start < earliest || start > latest) continue;
        if (this.overlaps(occupied, start, start + durationMs)) continue;
        slots.set(start, { startsAt: new Date(start), endsAt: new Date(start + durationMs) });
      }
    }
    return [...slots.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /** Lokale Daten im Zeitraum (einschließlich), an denen mindestens ein freier Slot existiert. */
  async availableDates(
    service: ServiceDocument,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<string[]> {
    if (service.type !== 'single' || !service.active) return [];
    const dates: string[] = [];
    for (const date of eachLocalDate(from, to)) {
      if ((await this.slotsForDate(service, date, now)).length > 0) dates.push(date);
    }
    return dates;
  }

  private async occupiedUnits(
    from: number,
    to: number,
    ignoreBookingId?: ObjectId,
  ): Promise<Set<number>> {
    const units = await this.c.resourceOccupancy
      .find(
        {
          resourceId: DEFAULT_RESOURCE_ID,
          unitStart: { $gte: new Date(from - UNIT_MS), $lt: new Date(to) },
          ...(ignoreBookingId
            ? { $nor: [{ refType: 'booking' as const, refId: ignoreBookingId }] }
            : {}),
        },
        { projection: { unitStart: 1 } },
      )
      .toArray();
    return new Set(units.map((u) => u.unitStart.getTime()));
  }

  /** Ob eine belegte 5-Minuten-Einheit den Bereich [start, end) berührt. */
  private overlaps(occupied: Set<number>, start: number, end: number): boolean {
    for (let unit = Math.floor(start / UNIT_MS) * UNIT_MS; unit < end; unit += UNIT_MS) {
      if (occupied.has(unit)) return true;
    }
    return false;
  }
}
