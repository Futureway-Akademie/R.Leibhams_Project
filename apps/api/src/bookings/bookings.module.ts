import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PublicModule } from '../public/public.module.js';
import { BookingService } from './booking.service.js';
import { BookingsController } from './bookings.controller.js';

@Module({
  imports: [PublicModule, AvailabilityModule],
  controllers: [BookingsController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingsModule {}
