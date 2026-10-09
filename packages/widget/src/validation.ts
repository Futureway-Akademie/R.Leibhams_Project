// Prüfung der Teilnehmerangaben im Browser, gleiche Regeln wie participantSchema in
// @fw-booking/shared (dort Zod, daher nicht importiert; validation.test.ts gleicht ab).
// Verbindlich prüft weiterhin die API.

export interface ParticipantDraft {
  name: string;
  email: string;
  phone: string;
}

export type ParticipantField = keyof ParticipantDraft | 'privacy';

const PHONE_PATTERN = /^[0-9 +\-/()]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Liefert die fehlerhaften Felder in Formular-Reihenfolge. */
export function validateParticipant(
  draft: ParticipantDraft,
  privacyAccepted: boolean,
): ParticipantField[] {
  const invalid: ParticipantField[] = [];
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 100) invalid.push('name');
  if (!EMAIL_PATTERN.test(draft.email.trim())) invalid.push('email');
  const phone = draft.phone.trim();
  if (!PHONE_PATTERN.test(phone) || !/\d/.test(phone)) invalid.push('phone');
  if (!privacyAccepted) invalid.push('privacy');
  return invalid;
}

/** Ordnet Feldpfade einer 400-Antwort der API den Formularfeldern zu. */
export function fieldsFromApiPaths(paths: readonly string[]): ParticipantField[] {
  const fields = new Set<ParticipantField>();
  for (const path of paths) {
    if (path === 'participant.name') fields.add('name');
    else if (path === 'participant.email') fields.add('email');
    else if (path === 'participant.phone') fields.add('phone');
    else if (path === 'privacyAccepted') fields.add('privacy');
  }
  return [...fields];
}
