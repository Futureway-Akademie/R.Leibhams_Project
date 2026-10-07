import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import { sha256Hex } from './crypto.js';

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface ThrottleKeys {
  email: string;
  ip: string;
}

/**
 * Zählt Fehlversuche je E-Mail und je IP in einem festen Fenster von 15 Minuten.
 * Ab 5 Fehlversuchen wird der Login bis zum Fensterende abgelehnt.
 */
@Injectable()
export class LoginThrottleService {
  private readonly c;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = collections(db);
  }

  private ids(keys: ThrottleKeys): string[] {
    return [`email:${sha256Hex(keys.email)}`, `ip:${keys.ip}`];
  }

  async isBlocked(keys: ThrottleKeys, now = new Date()): Promise<boolean> {
    const blocked = await this.c.loginAttempts.countDocuments({
      _id: { $in: this.ids(keys) },
      count: { $gte: MAX_FAILED_LOGINS },
      expiresAt: { $gt: now },
    });
    return blocked > 0;
  }

  async registerFailure(keys: ThrottleKeys, now = new Date()): Promise<void> {
    const windowEnd = new Date(now.getTime() + LOGIN_WINDOW_MS);
    await Promise.all(
      this.ids(keys).map((id) =>
        // Abgelaufenes Fenster: neu bei 1 beginnen. Der TTL-Index löscht nur verzögert.
        this.c.loginAttempts.updateOne(
          { _id: id },
          [
            {
              $set: {
                count: {
                  $cond: [{ $gt: ['$expiresAt', now] }, { $add: ['$count', 1] }, { $toInt: 1 }],
                },
                expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', windowEnd] },
              },
            },
          ],
          { upsert: true },
        ),
      ),
    );
  }

  /** Nach erfolgreichem Login wird nur der E-Mail-Zähler zurückgesetzt, nicht der IP-Zähler. */
  async resetEmail(email: string): Promise<void> {
    await this.c.loginAttempts.deleteOne({ _id: `email:${sha256Hex(email)}` });
  }
}
