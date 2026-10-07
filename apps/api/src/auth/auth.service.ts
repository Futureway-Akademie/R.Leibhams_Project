import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { PinoLogger } from 'nestjs-pino';
import { MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import { normalizeEmail, verifyAgainstDummy, verifyPassword } from './crypto.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SessionService } from './session.service.js';
import type { CreatedSession } from './session.service.js';

export const INVALID_CREDENTIALS = 'E-Mail oder Passwort ist falsch';

export interface LoginResult extends CreatedSession {
  owner: { id: ObjectId; email: string };
}

@Injectable()
export class AuthService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly logger: PinoLogger,
  ) {
    this.c = collections(db);
    logger.setContext(AuthService.name);
  }

  async login(
    emailInput: string,
    password: string,
    ip: string,
    previousToken?: string,
  ): Promise<LoginResult> {
    const email = normalizeEmail(emailInput);
    const keys = { email, ip };

    if (await this.throttle.isBlocked(keys)) {
      throw new HttpException(
        'Zu viele fehlgeschlagene Anmeldeversuche. Bitte später erneut versuchen.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const owner = await this.c.owners.findOne({ email });
    const passwordOk = owner
      ? await verifyPassword(owner.passwordHash, password)
      : await verifyAgainstDummy(password);

    if (!owner || !passwordOk || owner.status !== 'active') {
      await this.throttle.registerFailure(keys);
      this.logger.warn('Fehlgeschlagener Login');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.throttle.resetEmail(email);
    // Sitzungswechsel bei jedem Login (Schutz vor Session Fixation).
    if (previousToken) await this.sessions.destroy(previousToken);
    const session = await this.sessions.create(owner._id);

    await this.c.auditEvents.insertOne({
      _id: new ObjectId(),
      at: new Date(),
      actor: { type: 'owner', id: owner._id.toHexString() },
      action: 'owner.login',
      objectType: 'owner',
      objectId: owner._id,
      details: {},
    });

    return { ...session, owner: { id: owner._id, email: owner.email } };
  }

  async logout(ownerId: ObjectId, token: string): Promise<void> {
    await this.sessions.destroy(token);
    await this.c.auditEvents.insertOne({
      _id: new ObjectId(),
      at: new Date(),
      actor: { type: 'owner', id: ownerId.toHexString() },
      action: 'owner.logout',
      objectType: 'owner',
      objectId: ownerId,
      details: {},
    });
  }
}
