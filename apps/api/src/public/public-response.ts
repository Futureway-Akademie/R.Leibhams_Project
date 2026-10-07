import { InternalServerErrorException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Prüft eine öffentliche Antwort gegen ihr striktes Schema, bevor sie gesendet wird.
 * Enthält sie unerwartete Felder (z. B. Teilnehmerdaten), wird nichts ausgeliefert.
 */
export function assertPublic<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InternalServerErrorException('Antwort entspricht nicht dem öffentlichen Format');
  }
  return result.data;
}

export const CACHE_SERVICES = 'public, max-age=300';
export const CACHE_AVAILABILITY = 'public, max-age=30';
