// Wiederholungsregel für vorübergehende Fehler (docs/decisions.md, Worker mit Job-Leases).

/** Höchstzahl der Verarbeitungsversuche; danach wird ein Job endgültig `failed`. */
export const MAX_ATTEMPTS = 6;

/** Wartezeit vor dem nächsten Versuch, nach Versuch 1 bis 5 (in Minuten). */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180] as const;

/** Zufällige Abweichung, damit viele gleichzeitig gescheiterte Jobs nicht gemeinsam wiederkehren. */
export const JITTER = 0.1;

/** Dauer einer Lease. Ein abgestürzter Worker gibt seine Jobs spätestens danach frei. */
export const LEASE_MS = 5 * 60_000;

/** Zeitlimit eines Handlers, deutlich unter der Lease, damit kein zweiter Worker parallel startet. */
export const HANDLER_TIMEOUT_MS = 4 * 60_000;

/**
 * Wartezeit nach dem `attempt`-ten fehlgeschlagenen Versuch; `null`, wenn keine Wiederholung
 * mehr erfolgt. `random` liefert Werte in [0, 1).
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.max(0, attempt - 1)] ?? BACKOFF_MINUTES.at(-1) ?? 1;
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(minutes * 60_000 * factor);
}
