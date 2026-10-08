import type { Db } from 'mongodb';

export interface Migration {
  /** Eindeutig und sortierbar, z. B. `001-initial`. Nie umbenennen, nie wiederverwenden. */
  id: string;
  description: string;
  /** Muss bei erneuter Ausführung nach einem Abbruch gefahrlos sein. */
  up(db: Db): Promise<void>;
}

/** Legt eine Collection an, falls sie fehlt, und setzt ihren Validator. */
export async function ensureCollection(
  db: Db,
  name: string,
  validator?: Record<string, unknown>,
): Promise<void> {
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (!exists) {
    await db.createCollection(name);
  }
  if (validator) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }
}
