import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PublicCalendarService } from './public-calendar.service.js';
import { OwnerCalendarController, PublicCalendarController } from './public.controller.js';

@Module({
  imports: [AvailabilityModule],
  controllers: [PublicCalendarController, OwnerCalendarController],
  providers: [PublicCalendarService],
  exports: [PublicCalendarService],
})
export class PublicModule {}
