// Verwaltungs-Tokens für Storno und Umbuchung (docs/domain-rules.md 6). Gemeinsam für die API
// (Prüfung) und den Worker (Ausgabe beim Mailversand). Nur der SHA-256-Hash wird gespeichert.
import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { collections } from './documents.js';
import type { BookingDocument } from './documents.js';

/** Zufälliges Token mit 256 Bit, URL-sicher kodiert (43 Zeichen). */
export function randomActionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Erzeugt einen weiteren gültigen Link für eine Buchung (z. B. je E-Mail einen). Gültig bis
 * zum Terminende; mehrere Links einer Buchung sind gleichzeitig gültig.
 */
export async function issueActionToken(
  db: Db,
  booking: Pick<BookingDocument, '_id' | 'endsAt'>,
  now = new Date(),
): Promise<string> {
  const token = randomActionToken();
  await collections(db).actionTokens.insertOne({
    _id: new ObjectId(),
    tokenHash: hashActionToken(token),
    bookingId: booking._id,
    status: 'active',
    expiresAt: booking.endsAt,
    createdAt: now,
  });
  return token;
}
