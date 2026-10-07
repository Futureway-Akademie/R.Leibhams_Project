import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import {
  AvailabilityExceptionsController,
  OpeningHoursController,
} from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { SlotService } from './slot.service.js';
import { SlotsController } from './slots.controller.js';

@Module({
  imports: [CatalogModule],
  controllers: [OpeningHoursController, AvailabilityExceptionsController, SlotsController],
  providers: [AvailabilityService, SlotService],
  exports: [AvailabilityService, SlotService],
})
export class AvailabilityModule {}
