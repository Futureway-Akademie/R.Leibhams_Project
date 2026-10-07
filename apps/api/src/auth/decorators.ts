import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedOwner } from './auth.guard.js';

export const IS_PUBLIC = 'fw:isPublic';

/** Gibt eine Route ohne Owner-Sitzung frei. Ohne diesen Decorator ist jede Route geschützt. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Der angemeldete Owner der aktuellen Anfrage. */
export const CurrentOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedOwner => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('CurrentOwner auf öffentlicher Route verwendet');
    return request.auth.owner;
  },
);
