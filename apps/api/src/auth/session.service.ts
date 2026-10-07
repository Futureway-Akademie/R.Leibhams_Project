import { Inject, Injectable } from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type { AuthSessionDocument, OwnerDocument } from '../database/documents.js';
import { randomToken, sha256Hex } from './crypto.js';

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** Die Inaktivitätsfrist wird höchstens einmal pro Minute verlängert, um Schreiblast zu sparen. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface CreatedSession {
  /** Klartext-Token für das Cookie. Wird nicht gespeichert. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ValidSession {
  session: AuthSessionDocument;
  owner: OwnerDocument;
}

@Injectable()
export class SessionService {
  private readonly c;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = collections(db);
  }

  async create(ownerId: ObjectId, now = new Date()): Promise<CreatedSession> {
    const token = randomToken();
    const csrfToken = randomToken();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const expiresAt = idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;
    await this.c.authSessions.insertOne({
      _id: sha256Hex(token),
      ownerId,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      expiresAt,
    });
    return { token, csrfToken, expiresAt };
  }

  /** Liefert die Sitzung nur, wenn sie gültig und der Owner aktiv ist; sonst wird sie entfernt. */
  async validate(token: string, now = new Date()): Promise<ValidSession | null> {
    const id = sha256Hex(token);
    const session = await this.c.authSessions.findOne({ _id: id });
    if (!session) return null;

    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
      await this.c.authSessions.deleteOne({ _id: id });
      return null;
    }

    const owner = await this.c.owners.findOne({ _id: session.ownerId });
    if (owner?.status !== 'active') {
      await this.c.authSessions.deleteMany({ ownerId: session.ownerId });
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
      const expiresAt =
        idleExpiresAt < session.absoluteExpiresAt ? idleExpiresAt : session.absoluteExpiresAt;
      await this.c.authSessions.updateOne(
        { _id: id },
        { $set: { lastSeenAt: now, idleExpiresAt, expiresAt } },
      );
      Object.assign(session, { lastSeenAt: now, idleExpiresAt, expiresAt });
    }
    return { session, owner };
  }

  async destroy(token: string): Promise<void> {
    await this.c.authSessions.deleteOne({ _id: sha256Hex(token) });
  }

  async destroyAllForOwner(ownerId: ObjectId): Promise<void> {
    await this.c.authSessions.deleteMany({ ownerId });
  }
}
