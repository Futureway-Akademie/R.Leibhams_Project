import { describe, expect, it } from 'vitest';
import { classify, permanentFailure, temporaryFailure } from './errors.js';
import {
  BACKOFF_MINUTES,
  HANDLER_TIMEOUT_MS,
  LEASE_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
} from './retry.js';

const MINUTE = 60_000;

describe('retryDelayMs', () => {
  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
    [4, 60],
    [5, 180],
  ])('wartet nach Versuch %i rund %i Minuten', (attempt, minutes) => {
    expect(retryDelayMs(attempt, () => 0.5)).toBe(minutes * MINUTE);
    expect(retryDelayMs(attempt, () => 0)).toBe(Math.round(minutes * MINUTE * 0.9));
    expect(retryDelayMs(attempt, () => 0.999999)).toBeLessThanOrEqual(minutes * MINUTE * 1.1);
  });

  it('wiederholt nach dem letzten Versuch nicht mehr', () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(MAX_ATTEMPTS + 1)).toBeNull();
  });

  it('verteilt Wiederholungen über rund vier Stunden', () => {
    const total = BACKOFF_MINUTES.reduce((sum, m) => sum + m, 0);
    expect(total).toBe(261);
  });

  it('beendet Handler vor Ablauf der Lease', () => {
    expect(HANDLER_TIMEOUT_MS).toBeLessThan(LEASE_MS);
    expect(LEASE_MS).toBe(5 * MINUTE);
  });
});

describe('classify', () => {
  it('unterscheidet vorübergehende, dauerhafte und unerwartete Fehler', () => {
    expect(classify(temporaryFailure('smtp_unavailable'))).toEqual({
      category: 'smtp_unavailable',
      retryable: true,
    });
    expect(classify(permanentFailure('recipient_rejected'))).toEqual({
      category: 'recipient_rejected',
      retryable: false,
    });
    expect(classify(new Error('geheim'))).toEqual({ category: 'unexpected', retryable: true });
    expect(classify('kein Error')).toEqual({ category: 'unexpected', retryable: true });
  });
});
