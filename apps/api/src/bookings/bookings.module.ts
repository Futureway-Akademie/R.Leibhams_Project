import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PublicModule } from '../public/public.module.js';
import { ActionTokenService } from './action-token.service.js';
import { BookingService } from './booking.service.js';
import { BookingsController } from './bookings.controller.js';
import {
  OwnerBookingsController,
  SessionParticipantsController,
} from './owner-bookings.controller.js';
import { OwnerBookingsService } from './owner-bookings.service.js';
import { RebookService } from './rebook.service.js';
import { SelfServiceController } from './self-service.controller.js';
import { SelfServiceService } from './self-service.service.js';

@Module({
  imports: [PublicModule, AvailabilityModule],
  controllers: [
    BookingsController,
    SelfServiceController,
    OwnerBookingsController,
    SessionParticipantsController,
  ],
  providers: [
    BookingService,
    ActionTokenService,
    SelfServiceService,
    RebookService,
    OwnerBookingsService,
  ],
  exports: [BookingService, ActionTokenService, SelfServiceService],
})
export class BookingsModule {}
