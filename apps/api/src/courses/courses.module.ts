import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { CourseGenerationScheduler } from './course-generation.scheduler.js';
import { CourseRulesService } from './course-rules.service.js';
import { CourseSessionsService } from './course-sessions.service.js';
import { CourseRulesController, SessionsController } from './courses.controller.js';

@Module({
  imports: [AvailabilityModule],
  controllers: [SessionsController, CourseRulesController],
  providers: [CourseSessionsService, CourseRulesService, CourseGenerationScheduler],
  exports: [CourseSessionsService, CourseRulesService],
})
export class CoursesModule {}
