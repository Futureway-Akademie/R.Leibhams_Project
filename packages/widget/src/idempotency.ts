// Idempotenzschlüssel je Buchungsversuch. Derselbe Termin mit denselben Angaben behält seinen
// Schlüssel (z. B. erneutes Senden nach einem Netzwerkfehler), damit die API keine zweite Buchung
// anlegt; jede Änderung erzeugt einen neuen Schlüssel.

/** 128 Bit als Hex (32 Zeichen); getRandomValues funktioniert auch ohne sicheren Kontext. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IdempotencyKeys {
  /** Schlüssel für die Anfrage mit diesem Fingerabdruck (ohne Schlüssel serialisiert). */
  keyFor(fingerprint: string): string;
  /** Erzwingt beim nächsten Versuch einen neuen Schlüssel (nach idempotency_conflict). */
  reset(): void;
}

export function idempotencyKeys(generate: () => string = newIdempotencyKey): IdempotencyKeys {
  let last: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(fingerprint) {
      if (last?.fingerprint !== fingerprint) last = { fingerprint, key: generate() };
      return last.key;
    },
    reset() {
      last = null;
    },
  };
}
