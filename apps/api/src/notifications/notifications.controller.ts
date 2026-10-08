import { Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  failedNotificationsQuerySchema,
  failedNotificationsResponseSchema,
  notificationActionResultSchema,
} from '@fw-booking/shared';
import type {
  FailedNotificationsQuery,
  FailedNotificationsResponse,
  NotificationActionResult,
} from '@fw-booking/shared';
import type { Response } from 'express';
import type { ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CurrentOwner } from '../auth/decorators.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { assertPublic } from '../public/public-response.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Fehlgeschlagene Benachrichtigungen (nur für angemeldete Owner). Jede Antwort wird gegen ihr
 * striktes Schema geprüft; zusätzliche Felder wie Treiberdetails verhindern die Auslieferung.
 */
@Controller('owner/notifications/failed')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(failedNotificationsQuerySchema)) query: FailedNotificationsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FailedNotificationsResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return assertPublic(
      failedNotificationsResponseSchema,
      await this.notifications.listFailed(query),
    );
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<NotificationActionResult> {
    return assertPublic(notificationActionResultSchema, await this.notifications.retry(id, owner));
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<NotificationActionResult> {
    return assertPublic(
      notificationActionResultSchema,
      await this.notifications.dismiss(id, owner),
    );
  }
}
