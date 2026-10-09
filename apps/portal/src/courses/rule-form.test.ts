import type { CourseRule } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import { emptyRule, rulePatch, ruleToInput, validateRule } from './rule-form.js';

const RULE: CourseRule = {
  id: '66f1a2b3c4d5e6f708192c01',
  serviceId: '66f1a2b3c4d5e6f708192a01',
  weekdays: [3, 1],
  startTime: '18:00',
  validFrom: '2026-11-02',
  validUntil: null,
  capacity: null,
  location: 'Raum 1',
};

describe('Kursregeln', () => {
  it('erzeugt eine Regel mit sortierten Wochentagen und Standardwerten', () => {
    const input = { ...emptyRule('2026-10-09'), serviceId: RULE.serviceId, weekdays: [5, 2] };
    expect(validateRule(input)).toEqual({
      ok: true,
      data: {
        serviceId: RULE.serviceId,
        weekdays: [2, 5],
        startTime: '18:00',
        validFrom: '2026-10-09',
        validUntil: null,
        capacity: null,
        location: null,
      },
    });
  });

  it('meldet fehlende Angaben und einen verdrehten Zeitraum', () => {
    expect(
      validateRule({
        ...emptyRule('2026-10-09'),
        startTime: '18:02',
        validUntil: '2026-10-01',
        capacity: '1',
      }),
    ).toEqual({
      ok: false,
      firstError: 'serviceId',
      errors: {
        serviceId: 'Bitte einen Gruppenkurs wählen.',
        weekdays: 'Bitte mindestens einen Wochentag wählen.',
        startTime: 'Nur 5-Minuten-Schritte (z. B. 18:05).',
        validUntil: 'Das Ende darf nicht vor dem Beginn liegen.',
        capacity: 'Mindestens 2 Plätze oder leer lassen.',
      },
    });
  });

  it('liefert nur geänderte Felder ohne Angebot', () => {
    const unchanged = validateRule(ruleToInput(RULE));
    expect(unchanged.ok && rulePatch(RULE, unchanged.data)).toBeNull();
    const changed = validateRule({
      ...ruleToInput(RULE),
      weekdays: [1, 3, 5],
      validUntil: '2026-12-31',
      capacity: '10',
      location: '',
    });
    expect(changed.ok && rulePatch(RULE, changed.data)).toEqual({
      weekdays: [1, 3, 5],
      validUntil: '2026-12-31',
      capacity: 10,
      location: null,
    });
  });
});
