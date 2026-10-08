// Verwaltungs-Tokens für Storno und Umbuchung (docs/domain-rules.md 6).
// Nur der SHA-256-Hash wird gespeichert; der Klartext steht ausschließlich im Link der E-Mail.
import { Inject, Injectable } from '@nestjs/common';
import { hashActionToken, issueActionToken } from '@fw-booking/db';
import { bookingTokenSchema } from '@fw-booking/shared';
import { Db, ObjectId } from 'mongodb';
import type { ClientSession } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type {
  ActionTokenDocument,
  ActionTokenStatus,
  BookingDocument,
} from '../database/documents.js';

export type ResolvedToken =
  | { state: 'valid'; token: ActionTokenDocument; booking: BookingDocument }
  | { state: 'expired' }
  | { state: 'unknown' };

@Injectable()
export class ActionTokenService {
  private readonly c;

  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    this.c = collections(db);
  }

  /**
   * Erzeugt einen weiteren gültigen Link für eine Buchung (z. B. je E-Mail einen). Gültig bis
   * zum Terminende; mehrere Links einer Buchung sind gleichzeitig gültig.
   */
  async issue(booking: BookingDocument, now = new Date()): Promise<string> {
    return issueActionToken(this.db, booking, now);
  }

  /** Findet Token und Buchung. Verbrauchte Tokens bleiben bis zum Ablauf lesbar. */
  async resolve(token: string | undefined, now = new Date()): Promise<ResolvedToken> {
    if (!token || !bookingTokenSchema.safeParse(token).success) return { state: 'unknown' };
    const doc = await this.c.actionTokens.findOne({ tokenHash: hashActionToken(token) });
    if (!doc) return { state: 'unknown' };
    if (doc.expiresAt <= now) return { state: 'expired' };
    const booking = await this.c.bookings.findOne({ _id: doc.bookingId });
    if (!booking) return { state: 'unknown' };
    return { state: 'valid', token: doc, booking };
  }

  /** Entwertet alle aktiven Links einer Buchung (nach Storno, Umbuchung oder Absage). */
  async invalidateAll(
    bookingId: ObjectId,
    status: Exclude<ActionTokenStatus, 'active'>,
    session?: ClientSession,
  ): Promise<void> {
    await this.c.actionTokens.updateMany(
      { bookingId, status: 'active' },
      { $set: { status } },
      session ? { session } : {},
    );
  }
}
