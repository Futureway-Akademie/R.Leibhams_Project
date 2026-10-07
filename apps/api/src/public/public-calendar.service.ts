import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addLocalDays, localBoundaryToUtc } from '@fw-booking/shared';
import { Db, ObjectId } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type {
  GroupServiceDocument,
  ServiceDocument,
  SessionDocument,
  SettingsDocument,
} from '../database/documents.js';

const MINUTE_MS = 60_000;

@Injectable()
export class PublicCalendarService {
  private readonly c;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = collections(db);
  }

  /** Einstellungen der Installation, wenn die Kalenderkennung stimmt; sonst 404. */
  async settingsFor(calendarId: string): Promise<SettingsDocument> {
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    if (!settings || settings.publicCalendarId !== calendarId) {
      throw new NotFoundException('Kalender nicht gefunden');
    }
    return settings;
  }

  activeServices(): Promise<ServiceDocument[]> {
    return this.c.services.find({ active: true }, { sort: { sortOrder: 1, _id: 1 } }).toArray();
  }

  /** Aktives Angebot; unbekannte, ungültige und deaktivierte IDs ergeben gleichermaßen 404. */
  async activeService(id: string): Promise<ServiceDocument> {
    const service =
      ObjectId.isValid(id) && /^[0-9a-f]{24}$/.test(id)
        ? await this.c.services.findOne({ _id: new ObjectId(id), active: true })
        : null;
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    return service;
  }

  /**
   * Buchbare Kurstermine im Zeitraum: nur geplante (nicht gesperrte oder abgesagte) Termine
   * innerhalb von Mindestvorlauf und Horizont. Ausgebuchte Termine sind enthalten.
   */
  async bookableSessions(
    service: ServiceDocument,
    settings: SettingsDocument,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<{ service: GroupServiceDocument; sessions: SessionDocument[] }> {
    if (service.type !== 'group') {
      throw new BadRequestException('Kurstermine gibt es nur für Gruppenkurse');
    }
    const minLead = service.bookingRules.minLeadMinutes ?? settings.defaultMinLeadMinutes;
    const horizonDays = service.bookingRules.horizonDays ?? settings.defaultHorizonDays;
    const rangeStart = Date.parse(localBoundaryToUtc(`${from}T00:00`, settings.timeZone));
    const rangeEnd = Date.parse(
      localBoundaryToUtc(`${addLocalDays(to, 1)}T00:00`, settings.timeZone),
    );
    const earliest = now.getTime() + minLead * MINUTE_MS;
    const latest = now.getTime() + horizonDays * 24 * 60 * MINUTE_MS;

    const sessions = await this.c.sessions
      .find(
        {
          serviceId: service._id,
          status: 'scheduled',
          startsAt: {
            $gte: new Date(Math.max(rangeStart, earliest)),
            $lt: new Date(rangeEnd),
            $lte: new Date(latest),
          },
        },
        { sort: { startsAt: 1, _id: 1 } },
      )
      .toArray();
    return { service, sessions };
  }
}
