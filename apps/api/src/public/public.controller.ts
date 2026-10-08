import { BadRequestException, Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import {
  availableDatesQuerySchema,
  availableDatesResponseSchema,
  ownerCalendarResponseSchema,
  publicServicesResponseSchema,
  publicSessionsQuerySchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
  slotsQuerySchema,
} from '@fw-booking/shared';
import type {
  AvailableDatesQuery,
  AvailableDatesResponse,
  OwnerCalendarResponse,
  PublicService,
  PublicServicesResponse,
  PublicSessionsQuery,
  PublicSessionsResponse,
  PublicSlotsResponse,
  SlotsQuery,
} from '@fw-booking/shared';
import type { Response } from 'express';
import { Db } from 'mongodb';
import { Public } from '../auth/decorators.js';
import { SlotService } from '../availability/slot.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MONGO_DB } from '../database/database.module.js';
import { SETTINGS_ID, collections } from '../database/documents.js';
import type { ServiceDocument } from '../database/documents.js';
import { PublicCalendarService } from './public-calendar.service.js';
import { CACHE_AVAILABILITY, CACHE_SERVICES, assertPublic } from './public-response.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

/** Nur die für Interessenten nötigen Felder; keine Fristen oder internen Daten. */
function toPublicService(doc: ServiceDocument): PublicService {
  const base = {
    id: doc._id.toHexString(),
    title: doc.title,
    description: doc.description,
    durationMinutes: doc.durationMinutes,
  };
  return doc.type === 'single' ? { ...base, type: 'single' } : { ...base, type: 'group' };
}

/** Öffentliche Verfügbarkeiten für das Widget. Enthält keine personenbezogenen Daten. */
@Public()
@Controller('public/calendars/:calendarId')
export class PublicCalendarController {
  constructor(
    private readonly calendar: PublicCalendarService,
    private readonly slots: SlotService,
  ) {}

  @Get('services')
  async services(
    @Param('calendarId') calendarId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicServicesResponse> {
    const settings = await this.calendar.settingsFor(calendarId);
    const services = await this.calendar.activeServices();
    res.setHeader('Cache-Control', CACHE_SERVICES);
    return assertPublic(publicServicesResponseSchema, {
      timeZone: settings.timeZone,
      services: services.map(toPublicService),
    });
  }

  @Get('services/:serviceId/slots')
  async serviceSlots(
    @Param('calendarId') calendarId: string,
    @Param('serviceId') serviceId: string,
    @Query(new ZodValidationPipe(slotsQuerySchema)) query: SlotsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSlotsResponse> {
    const settings = await this.calendar.settingsFor(calendarId);
    const service = await this.singleService(serviceId);
    const slots = await this.slots.slotsForDate(service, query.date);
    res.setHeader('Cache-Control', CACHE_AVAILABILITY);
    return assertPublic(publicSlotsResponseSchema, {
      serviceId,
      timeZone: settings.timeZone,
      slots: slots.map((s) => ({ startsAt: iso(s.startsAt), endsAt: iso(s.endsAt) })),
    });
  }

  @Get('services/:serviceId/available-dates')
  async availableDates(
    @Param('calendarId') calendarId: string,
    @Param('serviceId') serviceId: string,
    @Query(new ZodValidationPipe(availableDatesQuerySchema)) query: AvailableDatesQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AvailableDatesResponse> {
    const settings = await this.calendar.settingsFor(calendarId);
    const service = await this.singleService(serviceId);
    const dates = await this.slots.availableDates(service, query.from, query.to);
    res.setHeader('Cache-Control', CACHE_AVAILABILITY);
    return assertPublic(availableDatesResponseSchema, {
      serviceId,
      timeZone: settings.timeZone,
      dates,
    });
  }

  @Get('services/:serviceId/sessions')
  async sessions(
    @Param('calendarId') calendarId: string,
    @Param('serviceId') serviceId: string,
    @Query(new ZodValidationPipe(publicSessionsQuerySchema)) query: PublicSessionsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSessionsResponse> {
    const settings = await this.calendar.settingsFor(calendarId);
    const service = await this.calendar.activeService(serviceId);
    const { sessions } = await this.calendar.bookableSessions(
      service,
      settings,
      query.from,
      query.to,
    );
    res.setHeader('Cache-Control', CACHE_AVAILABILITY);
    return assertPublic(publicSessionsResponseSchema, {
      serviceId,
      timeZone: settings.timeZone,
      sessions: sessions.map((s) => ({
        id: s._id.toHexString(),
        serviceId,
        startsAt: iso(s.startsAt),
        endsAt: iso(s.endsAt),
        freeSeats: Math.max(0, s.capacity - s.bookedCount),
        location: s.location,
      })),
    });
  }

  private async singleService(serviceId: string) {
    const service = await this.calendar.activeService(serviceId);
    if (service.type !== 'single') {
      throw new BadRequestException('Slots gibt es nur für Einzeltermine');
    }
    return service;
  }
}

/** Kalenderkennung für die Einbindung, sichtbar für den Owner. */
@Controller('owner/calendar')
export class OwnerCalendarController {
  private readonly c;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = collections(db);
  }

  @Get()
  async get(): Promise<OwnerCalendarResponse> {
    const settings = await this.c.settings.findOne({ _id: SETTINGS_ID });
    return ownerCalendarResponseSchema.parse({
      calendarId: settings?.publicCalendarId,
      timeZone: settings?.timeZone,
    });
  }
}
