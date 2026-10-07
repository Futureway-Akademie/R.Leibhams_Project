import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ObjectId } from 'mongodb';
import { APP_CONFIG } from '../config/config.js';
import type { AppConfig } from '../config/config.js';
import { safeEqual } from './crypto.js';
import { IS_PUBLIC } from './decorators.js';
import { sessionCookieName } from './session-cookie.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthenticatedOwner {
  id: ObjectId;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: { owner: AuthenticatedOwner; sessionToken: string; csrfToken: string };
}

/**
 * Globaler Schutz („standardmäßig gesperrt“):
 * - Ändernde Anfragen müssen JSON senden (erzwingt bei fremden Origins einen CORS-Preflight).
 * - Nicht mit @Public() markierte Routen verlangen eine gültige Owner-Sitzung.
 * - Ändernde Anfragen mit Sitzung verlangen das CSRF-Token der Sitzung im Header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const mutating = !SAFE_METHODS.has(request.method);

    if (mutating && !request.is('application/json')) {
      throw new UnsupportedMediaTypeException('Content-Type application/json erforderlich');
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const cookies = request.cookies as Record<string, string | undefined>;
    const token = cookies[sessionCookieName(this.config)];
    const valid = token ? await this.sessions.validate(token) : null;
    if (!token || !valid) throw new UnauthorizedException();

    if (mutating) {
      const header = request.header(CSRF_HEADER);
      if (!header || !safeEqual(header, valid.session.csrfToken)) {
        throw new ForbiddenException('CSRF-Token fehlt oder ist ungültig');
      }
    }

    request.auth = {
      owner: { id: valid.owner._id, email: valid.owner.email },
      sessionToken: token,
      csrfToken: valid.session.csrfToken,
    };
    return true;
  }
}
