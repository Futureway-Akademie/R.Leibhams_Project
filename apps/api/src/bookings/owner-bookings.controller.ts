import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { bookingQuerySchema, ownerCancellationSchema } from '@fw-booking/shared';
import type {
  Booking,
  BookingQuery,
  OwnerBookingCancelResult,
  OwnerCancellation,
  SessionCancelResult,
  SessionParticipants,
} from '@fw-booking/shared';
import type { Response } from 'express';
import type { ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CurrentOwner } from '../auth/decorators.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { toSessionDto } from '../courses/mappers.js';
import { toBookingDto } from './booking.mapper.js';
import { OwnerBookingsService } from './owner-bookings.service.js';

/** Antworten mit Teilnehmerdaten dürfen nicht zwischengespeichert werden. */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/** Buchungsübersicht und Absage einzelner Buchungen (nur für angemeldete Owner). */
@Controller('owner/bookings')
export class OwnerBookingsController {
  constructor(private readonly bookings: OwnerBookingsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(bookingQuerySchema)) query: BookingQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Booking[]> {
    noStore(res);
    return (await this.bookings.list(query)).map(toBookingDto);
  }

  @Get(':id')
  async get(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Booking> {
    noStore(res);
    return toBookingDto(await this.bookings.get(id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Body(new ZodValidationPipe(ownerCancellationSchema)) body: OwnerCancellation,
    @CurrentOwner() owner: AuthenticatedOwner,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OwnerBookingCancelResult> {
    noStore(res);
    const result = await this.bookings.cancelBooking(id, body.reason, owner);
    return { booking: toBookingDto(result.booking), alreadyCancelled: result.alreadyCancelled };
  }
}

/** Teilnehmerliste und Absage eines Kurstermins (Ergänzung zu `owner/sessions`). */
@Controller('owner/sessions')
export class SessionParticipantsController {
  constructor(private readonly bookings: OwnerBookingsService) {}

  @Get(':id/participants')
  async participants(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionParticipants> {
    noStore(res);
    const result = await this.bookings.participants(id);
    return { session: toSessionDto(result.session), bookings: result.bookings.map(toBookingDto) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Body(new ZodValidationPipe(ownerCancellationSchema)) body: OwnerCancellation,
    @CurrentOwner() owner: AuthenticatedOwner,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionCancelResult> {
    noStore(res);
    const result = await this.bookings.cancelSession(id, body.reason, owner);
    return {
      session: toSessionDto(result.session),
      cancelledBookings: result.cancelledBookings,
      alreadyCancelled: result.alreadyCancelled,
    };
  }
}
