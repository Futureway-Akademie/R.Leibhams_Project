import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { availableDatesQuerySchema, slotsQuerySchema } from '@fw-booking/shared';
import type {
  AvailableDatesQuery,
  AvailableDatesResponse,
  PublicSlotsResponse,
  SlotsQuery,
} from '@fw-booking/shared';
import type { ObjectId } from 'mongodb';
import { CatalogService } from '../catalog/catalog.service.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AvailabilityService } from './availability.service.js';
import { SlotService } from './slot.service.js';

/** Vorschau der freien Slots für Owner; der öffentliche Abruf folgt in task-2-8. */
@Controller('owner/services/:id')
export class SlotsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly availability: AvailabilityService,
    private readonly slots: SlotService,
  ) {}

  private async singleService(id: ObjectId) {
    const service = await this.catalog.get(id);
    if (service.type !== 'single') {
      throw new BadRequestException('Slots gibt es nur für Einzeltermine');
    }
    return service;
  }

  @Get('slots')
  async list(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Query(new ZodValidationPipe(slotsQuerySchema)) query: SlotsQuery,
  ): Promise<PublicSlotsResponse> {
    const service = await this.singleService(id);
    const slots = await this.slots.slotsForDate(service, query.date);
    return {
      serviceId: id.toHexString(),
      timeZone: await this.availability.timeZone(),
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString().replace('.000Z', 'Z'),
        endsAt: s.endsAt.toISOString().replace('.000Z', 'Z'),
      })),
    };
  }

  @Get('available-dates')
  async availableDates(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Query(new ZodValidationPipe(availableDatesQuerySchema)) query: AvailableDatesQuery,
  ): Promise<AvailableDatesResponse> {
    const service = await this.singleService(id);
    return {
      serviceId: id.toHexString(),
      timeZone: await this.availability.timeZone(),
      dates: await this.slots.availableDates(service, query.from, query.to),
    };
  }
}
