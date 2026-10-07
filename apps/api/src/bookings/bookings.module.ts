import { Module } from '@nestjs/common';
import { PublicModule } from '../public/public.module.js';
import { BookingService } from './booking.service.js';
import { BookingsController } from './bookings.controller.js';

@Module({
  imports: [PublicModule],
  controllers: [BookingsController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingsModule {}
