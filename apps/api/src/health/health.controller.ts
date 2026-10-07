import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.module.js';

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
}

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const dbUp = await this.database.ping();
    res.setHeader('Cache-Control', 'no-store');
    if (!dbUp) {
      res.status(503);
      return { status: 'error', db: 'down' };
    }
    return { status: 'ok', db: 'up' };
  }
}
