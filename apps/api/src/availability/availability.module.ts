import { Module } from '@nestjs/common';
import {
  AvailabilityExceptionsController,
  OpeningHoursController,
} from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  controllers: [OpeningHoursController, AvailabilityExceptionsController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
