import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res } from '@nestjs/common';
import {
  BOOKING_TOKEN_HEADER,
  availableDatesQuerySchema,
  publicSessionsResponseSchema,
  publicSlotsResponseSchema,
  selfServiceBookingSchema,
  selfServiceCancelRequestSchema,
  selfServiceRebookRequestSchema,
  slotsQuerySchema,
} from '@fw-booking/shared';
import type {
  AvailableDatesQuery,
  PublicSessionsResponse,
  PublicSlotsResponse,
  SelfServiceBooking,
  SelfServiceCancelRequest,
  SelfServiceRebookRequest,
  SlotsQuery,
} from '@fw-booking/shared';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { assertPublic } from '../public/public-response.js';
import { RebookService } from './rebook.service.js';
import { SelfServiceService } from './self-service.service.js';

const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');

/**
 * Selbstverwaltung über den Verwaltungslink. Das Token kommt aus dem Link-Fragment und wird im
 * Header `X-Booking-Token` gesendet, nie in der URL.
 */
@Public()
@Controller('public/manage')
export class SelfServiceController {
  constructor(
    private readonly selfService: SelfServiceService,
    private readonly rebooking: RebookService,
  ) {}

  private noStore(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  @Get()
  async view(
    @Headers(BOOKING_TOKEN_HEADER) token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SelfServiceBooking> {
    this.noStore(res);
    return assertPublic(selfServiceBookingSchema, await this.selfService.view(token));
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(
    @Headers(BOOKING_TOKEN_HEADER) token: string | undefined,
    @Body(new ZodValidationPipe(selfServiceCancelRequestSchema)) _body: SelfServiceCancelRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SelfServiceBooking & { alreadyCancelled: boolean }> {
    this.noStore(res);
    const result = await this.selfService.cancel(token);
    return {
      ...assertPublic(selfServiceBookingSchema, result.view),
      alreadyCancelled: result.alreadyCancelled,
    };
  }

  /** Mögliche neue Startzeiten eines Einzeltermins (die eigene Zeit gilt als frei). */
  @Get('slots')
  async slots(
    @Headers(BOOKING_TOKEN_HEADER) token: string | undefined,
    @Query(new ZodValidationPipe(slotsQuerySchema)) query: SlotsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSlotsResponse> {
    this.noStore(res);
    const result = await this.rebooking.slotOptions(token, query.date);
    return assertPublic(publicSlotsResponseSchema, {
      serviceId: result.serviceId,
      timeZone: result.timeZone,
      slots: result.slots.map((s) => ({ startsAt: iso(s.startsAt), endsAt: iso(s.endsAt) })),
    });
  }

  /** Andere Kurstermine desselben Kurses. */
  @Get('sessions')
  async sessions(
    @Headers(BOOKING_TOKEN_HEADER) token: string | undefined,
    @Query(new ZodValidationPipe(availableDatesQuerySchema)) query: AvailableDatesQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSessionsResponse> {
    this.noStore(res);
    const result = await this.rebooking.sessionOptions(token, query);
    return assertPublic(publicSessionsResponseSchema, {
      serviceId: result.serviceId,
      timeZone: result.timeZone,
      sessions: result.sessions.map((s) => ({
        id: s._id.toHexString(),
        serviceId: result.serviceId,
        startsAt: iso(s.startsAt),
        endsAt: iso(s.endsAt),
        freeSeats: Math.max(0, s.capacity - s.bookedCount),
        location: s.location,
      })),
    });
  }

  @Post('rebook')
  @HttpCode(200)
  async rebook(
    @Headers(BOOKING_TOKEN_HEADER) token: string | undefined,
    @Body(new ZodValidationPipe(selfServiceRebookRequestSchema)) body: SelfServiceRebookRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SelfServiceBooking & { alreadyRebooked: boolean }> {
    this.noStore(res);
    const result = await this.rebooking.rebook(token, body);
    return {
      ...assertPublic(selfServiceBookingSchema, result.view),
      alreadyRebooked: result.alreadyRebooked,
    };
  }
}
