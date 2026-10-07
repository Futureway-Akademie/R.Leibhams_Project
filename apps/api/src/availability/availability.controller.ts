import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  availabilityExceptionCreateSchema,
  availabilityExceptionQuerySchema,
  openingHoursUpdateSchema,
} from '@fw-booking/shared';
import type {
  AvailabilityException,
  AvailabilityExceptionCreate,
  AvailabilityExceptionCreated,
  AvailabilityExceptionQuery,
  OpeningHoursResponse,
  OpeningHoursUpdate,
} from '@fw-booking/shared';
import type { ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CurrentOwner } from '../auth/decorators.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AvailabilityExceptionDocument } from '../database/documents.js';
import { AvailabilityService } from './availability.service.js';

function toExceptionDto(doc: AvailabilityExceptionDocument): AvailabilityException {
  return {
    id: doc._id.toHexString(),
    kind: doc.kind,
    start: doc.start,
    end: doc.end,
    note: doc.note,
  };
}

/** Wöchentliche Öffnungszeiten für Einzeltermine. */
@Controller('owner/opening-hours')
export class OpeningHoursController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async get(): Promise<OpeningHoursResponse> {
    return {
      timeZone: await this.availability.timeZone(),
      days: await this.availability.getOpeningHours(),
    };
  }

  @Put()
  async replace(
    @Body(new ZodValidationPipe(openingHoursUpdateSchema)) body: OpeningHoursUpdate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<OpeningHoursResponse> {
    return {
      timeZone: await this.availability.timeZone(),
      days: await this.availability.replaceOpeningHours(body.days, owner),
    };
  }
}

/** Sperrzeiten und zusätzliche Öffnungen. */
@Controller('owner/availability-exceptions')
export class AvailabilityExceptionsController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(availabilityExceptionQuerySchema))
    query: AvailabilityExceptionQuery,
  ): Promise<AvailabilityException[]> {
    return (await this.availability.listExceptions(query)).map(toExceptionDto);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(availabilityExceptionCreateSchema))
    body: AvailabilityExceptionCreate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<AvailabilityExceptionCreated> {
    const result = await this.availability.createException(body, owner);
    return {
      exception: toExceptionDto(result.exception),
      conflictingBookings: result.conflictingBookings,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<void> {
    await this.availability.deleteException(id, owner);
  }
}
