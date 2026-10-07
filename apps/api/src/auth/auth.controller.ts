import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { loginRequestSchema } from '@fw-booking/shared';
import type { LoginRequest } from '@fw-booking/shared';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/config.js';
import type { AppConfig } from '../config/config.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedOwner, AuthenticatedRequest } from './auth.guard.js';
import { CurrentOwner, Public } from './decorators.js';
import { clearSessionCookie, sessionCookieName, setSessionCookie } from './session-cookie.js';

export interface SessionResponse {
  owner: { id: string; email: string };
  csrfToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const result = await this.auth.login(
      body.email,
      body.password,
      req.ip ?? 'unknown',
      cookies[sessionCookieName(this.config)],
    );
    setSessionCookie(res, this.config, result.token, result.expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    return {
      owner: { id: result.owner.id.toHexString(), email: result.owner.email },
      csrfToken: result.csrfToken,
    };
  }

  @Get('session')
  session(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): SessionResponse {
    res.setHeader('Cache-Control', 'no-store');
    return {
      owner: { id: owner.id.toHexString(), email: owner.email },
      csrfToken: req.auth?.csrfToken ?? '',
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.auth) await this.auth.logout(owner.id, req.auth.sessionToken);
    clearSessionCookie(res, this.config);
  }
}
