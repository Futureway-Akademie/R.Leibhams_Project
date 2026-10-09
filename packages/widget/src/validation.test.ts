import { idempotencyKeySchema, participantSchema } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import { idempotencyKeys, newIdempotencyKey } from './idempotency.js';
import { fieldsFromApiPaths, validateParticipant } from './validation.js';

const valid = { name: 'Erika Mustermann', email: 'erika@example.de', phone: '+49 (0)170 123-4567' };

describe('validateParticipant', () => {
  it.each([
    ['name', 'E'],
    ['name', ' E '],
    ['name', 'x'.repeat(101)],
    ['email', 'erika'],
    ['email', 'erika@'],
    ['email', 'erika@example'],
    ['email', 'eri ka@example.de'],
    ['phone', '12345'],
    ['phone', '0170 12345678901234567'],
    ['phone', '0170-abc-123'],
    ['phone', '++++++'],
  ] as const)('lehnt %s „%s“ ab wie participantSchema', (field, value) => {
    const draft = { ...valid, [field]: value };
    expect(validateParticipant(draft, true)).toEqual([field]);
    expect(participantSchema.safeParse(draft).success).toBe(false);
  });

  it.each([
    { ...valid },
    { ...valid, name: '  Al  ' },
    { ...valid, phone: '030/123456' },
    { ...valid, email: ' erika.mustermann+test@sub.example.de ' },
  ])('akzeptiert gültige Angaben wie participantSchema (%o)', (draft) => {
    expect(validateParticipant(draft, true)).toEqual([]);
    expect(participantSchema.safeParse(draft).success).toBe(true);
  });

  it('verlangt die Bestätigung der Datenschutzhinweise', () => {
    expect(validateParticipant(valid, false)).toEqual(['privacy']);
  });

  it('nennt alle fehlerhaften Felder in Formular-Reihenfolge', () => {
    expect(validateParticipant({ name: '', email: '', phone: '' }, false)).toEqual([
      'name',
      'email',
      'phone',
      'privacy',
    ]);
  });
});

describe('fieldsFromApiPaths', () => {
  it('ordnet Pfade der API den Feldern zu und ignoriert andere', () => {
    expect(
      fieldsFromApiPaths([
        'participant.phone',
        'participant.email',
        'participant.email',
        'privacyAccepted',
        'sessionId',
      ]),
    ).toEqual(['phone', 'email', 'privacy']);
  });
});

describe('Idempotenzschlüssel', () => {
  it('erzeugt zufällige Schlüssel im Format der API', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(idempotencyKeySchema.safeParse(a).success).toBe(true);
  });

  it('behält den Schlüssel für dieselbe Anfrage und wechselt bei Änderungen oder reset()', () => {
    let n = 0;
    const keys = idempotencyKeys(() => `key-${String(++n)}`);
    expect(keys.keyFor('a')).toBe('key-1');
    expect(keys.keyFor('a')).toBe('key-1');
    expect(keys.keyFor('b')).toBe('key-2');
    expect(keys.keyFor('a')).toBe('key-3');
    keys.reset();
    expect(keys.keyFor('a')).toBe('key-4');
  });
});
