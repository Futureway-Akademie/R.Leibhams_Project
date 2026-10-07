import { BadRequestException, Body, Controller, Param, Post, Res } from '@nestjs/common';
import { bookingConfirmationSchema, bookingRequestSchema } from '@fw-booking/shared';
import type { BookingConfirmation, BookingRequest } from '@fw-booking/shared';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PublicCalendarService } from '../public/public-calendar.service.js';
import { assertPublic } from '../public/public-response.js';
import { BookingService } from './booking.service.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

/** Öffentliche Buchung über das Widget. */
@Public()
@Controller('public/calendars/:calendarId/bookings')
export class BookingsController {
  constructor(
    private readonly calendar: PublicCalendarService,
    private readonly bookings: BookingService,
  ) {}

  @Post()
  async create(
    @Param('calendarId') calendarId: string,
    @Body(new ZodValidationPipe(bookingRequestSchema)) body: BookingRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BookingConfirmation> {
    const settings = await this.calendar.settingsFor(calendarId);
    if (body.type !== 'group') {
      // Einzeltermine folgen mit task-2-10.
      throw new BadRequestException('Einzeltermine sind noch nicht buchbar');
    }
    const result = await this.bookings.bookGroup(body, settings);
    res.status(result.replayed ? 200 : 201);
    res.setHeader('Cache-Control', 'no-store');
    return assertPublic(bookingConfirmationSchema, {
      bookingId: result.booking._id.toHexString(),
      status: result.booking.status,
      serviceTitle: result.service.title,
      startsAt: iso(result.booking.startsAt),
      endsAt: iso(result.booking.endsAt),
      timeZone: result.booking.timeZone,
    });
  }
}
