import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  courseRuleCreateSchema,
  courseRuleUpdateSchema,
  sessionCreateSchema,
  sessionQuerySchema,
  sessionUpdateSchema,
} from '@fw-booking/shared';
import type {
  CourseRule,
  CourseRuleCreate,
  CourseRuleResult,
  CourseRuleUpdate,
  Session,
  SessionCreate,
  SessionQuery,
  SessionUpdate,
} from '@fw-booking/shared';
import type { ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CurrentOwner } from '../auth/decorators.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CourseRulesService } from './course-rules.service.js';
import { CourseSessionsService } from './course-sessions.service.js';
import { toCourseRuleDto, toSessionDto } from './mappers.js';

/** Einzelne Kurstermine. Teilnehmerliste und Absage: `SessionParticipantsController`. */
@Controller('owner/sessions')
export class SessionsController {
  constructor(private readonly sessions: CourseSessionsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(sessionQuerySchema)) query: SessionQuery,
  ): Promise<Session[]> {
    return (await this.sessions.list(query)).map(toSessionDto);
  }

  @Get(':id')
  async get(@Param('id', ParseObjectIdPipe) id: ObjectId): Promise<Session> {
    return toSessionDto(await this.sessions.get(id));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(sessionCreateSchema)) body: SessionCreate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<Session> {
    return toSessionDto(await this.sessions.createManual(body, owner));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Body(new ZodValidationPipe(sessionUpdateSchema)) body: SessionUpdate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<Session> {
    return toSessionDto(await this.sessions.update(id, body, owner));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<void> {
    await this.sessions.remove(id, owner);
  }
}

/** Wiederkehrende Kursregeln. */
@Controller('owner/course-rules')
export class CourseRulesController {
  constructor(private readonly rules: CourseRulesService) {}

  @Get()
  async list(): Promise<CourseRule[]> {
    return (await this.rules.list()).map(toCourseRuleDto);
  }

  @Get(':id')
  async get(@Param('id', ParseObjectIdPipe) id: ObjectId): Promise<CourseRule> {
    return toCourseRuleDto(await this.rules.get(id));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(courseRuleCreateSchema)) body: CourseRuleCreate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<CourseRuleResult> {
    const result = await this.rules.create(body, owner);
    return { rule: toCourseRuleDto(result.rule), generation: result.generation };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Body(new ZodValidationPipe(courseRuleUpdateSchema)) body: CourseRuleUpdate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<CourseRuleResult> {
    const result = await this.rules.update(id, body, owner);
    return { rule: toCourseRuleDto(result.rule), generation: result.generation };
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<{ keptWithBookings: string[] }> {
    return this.rules.remove(id, owner);
  }
}
