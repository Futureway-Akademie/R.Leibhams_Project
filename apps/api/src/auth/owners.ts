import { ObjectId } from 'mongodb';
import type { Db, MongoServerError } from 'mongodb';
import { z } from 'zod';
import { collections } from '../database/documents.js';
import { MIN_PASSWORD_LENGTH, hashPassword, normalizeEmail } from './crypto.js';

export class OwnerCreationError extends Error {
  override name = 'OwnerCreationError';
}

const emailSchema = z.email();

/** Legt einen aktiven Owner an. Wird vom CLI-Befehl owner:create und in Tests genutzt. */
export async function createOwner(db: Db, emailInput: string, password: string): Promise<ObjectId> {
  const email = normalizeEmail(emailInput);
  if (!emailSchema.safeParse(email).success) {
    throw new OwnerCreationError('Ungültige E-Mail-Adresse');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new OwnerCreationError(
      `Passwort muss mindestens ${String(MIN_PASSWORD_LENGTH)} Zeichen lang sein`,
    );
  }
  const now = new Date();
  const _id = new ObjectId();
  try {
    await collections(db).owners.insertOne({
      _id,
      email,
      passwordHash: await hashPassword(password),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if ((error as MongoServerError).code === 11000) {
      throw new OwnerCreationError('Für diese E-Mail-Adresse existiert bereits ein Konto');
    }
    throw error;
  }
  return _id;
}
