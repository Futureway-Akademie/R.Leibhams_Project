import { Body, Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import {
  BOOKING_TOKEN_HEADER,
  selfServiceBookingSchema,
  selfServiceCancelRequestSchema,
} from '@fw-booking/shared';
import type { SelfServiceBooking, SelfServiceCancelRequest } from '@fw-booking/shared';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { assertPublic } from '../public/public-response.js';
import { SelfServiceService } from './self-service.service.js';

/**
 * Selbstverwaltung über den Verwaltungslink. Das Token kommt aus dem Link-Fragment und wird im
 * Header `X-Booking-Token` gesendet, nie in der URL.
 */
@Public()
@Controller('public/manage')
export class SelfServiceController {
  constructor(private readonly selfService: SelfServiceService) {}

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
}
