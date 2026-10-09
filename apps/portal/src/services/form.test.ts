import type { Service } from '@fw-booking/shared';
import { describe, expect, it } from 'vitest';
import {
  emptyServiceForm,
  fieldErrorsFromPaths,
  servicePatch,
  serviceToForm,
  validateServiceForm,
} from './form.js';
import type { ServiceFormValues } from './form.js';

const META = {
  sortOrder: 0,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const YOGA: Service = {
  id: '66f1a2b3c4d5e6f708192a01',
  type: 'group',
  title: 'Yoga',
  description: 'Für alle Level',
  active: true,
  durationMinutes: 60,
  defaultCapacity: 12,
  bookingRules: { minLeadMinutes: 90, horizonDays: null, changeDeadlineMinutes: null },
  ...META,
};

const HAIRCUT: Service = {
  id: '66f1a2b3c4d5e6f708192a02',
  type: 'single',
  title: 'Haarschnitt',
  description: null,
  active: false,
  durationMinutes: 30,
  bookingRules: { minLeadMinutes: null, horizonDays: 30, changeDeadlineMinutes: 1440 },
  ...META,
};

function form(patch: Partial<ServiceFormValues> = {}): ServiceFormValues {
  return { ...emptyServiceForm('single'), title: 'Bartrasur', ...patch };
}

describe('validateServiceForm', () => {
  it('erzeugt ein gültiges Einzeltermin-Angebot ohne Kapazität und mit Standardfristen', () => {
    const result = validateServiceForm(form({ description: '  ', durationMinutes: ' 20 ' }));
    expect(result).toEqual({
      ok: true,
      data: {
        type: 'single',
        title: 'Bartrasur',
        description: null,
        active: true,
        durationMinutes: 20,
        bookingRules: { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null },
      },
    });
  });

  it('übernimmt bei Gruppenkursen die Kapazität', () => {
    const result = validateServiceForm({ ...emptyServiceForm('group'), title: 'Pilates' });
    expect(result.ok && result.data).toMatchObject({ type: 'group', defaultCapacity: 10 });
  });

  it('rechnet Stunden in Minuten um und akzeptiert Dezimalkomma', () => {
    const values = form();
    values.rules = {
      minLeadMinutes: { useDefault: false, value: '1,5' },
      horizonDays: { useDefault: false, value: '60' },
      changeDeadlineMinutes: { useDefault: false, value: '0' },
    };
    const result = validateServiceForm(values);
    expect(result.ok && result.data.bookingRules).toEqual({
      minLeadMinutes: 90,
      horizonDays: 60,
      changeDeadlineMinutes: 0,
    });
  });

  it('meldet ungültige Felder mit deutschen Texten und dem ersten Fehler', () => {
    const values: ServiceFormValues = {
      ...emptyServiceForm('group'),
      title: ' ',
      durationMinutes: '22',
      defaultCapacity: '1',
    };
    values.rules.horizonDays = { useDefault: false, value: '0' };
    values.rules.minLeadMinutes = { useDefault: false, value: 'abc' };
    const result = validateServiceForm(values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.firstError).toBe('title');
    expect(Object.keys(result.errors).sort()).toEqual([
      'bookingRules.horizonDays',
      'bookingRules.minLeadMinutes',
      'defaultCapacity',
      'durationMinutes',
      'title',
    ]);
    expect(result.errors.durationMinutes).toContain('5-Minuten-Schritten');
  });

  it('meldet fehlende Dauer und Werte außerhalb der Grenzen', () => {
    for (const durationMinutes of ['', '0', '485', '-5', '2.5']) {
      const result = validateServiceForm(form({ durationMinutes }));
      expect(result.ok ? null : result.errors.durationMinutes).toBeTruthy();
    }
  });
});

describe('serviceToForm', () => {
  it('stellt gespeicherte Werte als Eingaben dar (Minuten → Stunden)', () => {
    expect(serviceToForm(YOGA)).toEqual({
      type: 'group',
      title: 'Yoga',
      description: 'Für alle Level',
      durationMinutes: '60',
      defaultCapacity: '12',
      active: true,
      rules: {
        minLeadMinutes: { useDefault: false, value: '1.5' },
        horizonDays: { useDefault: true, value: '' },
        changeDeadlineMinutes: { useDefault: true, value: '' },
      },
    });
    expect(serviceToForm(HAIRCUT)).toMatchObject({
      description: '',
      defaultCapacity: '',
      active: false,
      rules: { changeDeadlineMinutes: { useDefault: false, value: '24' } },
    });
  });
});

describe('servicePatch', () => {
  function roundTrip(service: Service, change: (v: ServiceFormValues) => void) {
    const values = serviceToForm(service);
    change(values);
    const result = validateServiceForm(values);
    if (!result.ok) throw new Error('ungültig');
    return servicePatch(service, result.data);
  }

  it('liefert null ohne Änderungen', () => {
    expect(roundTrip(YOGA, () => undefined)).toBeNull();
    expect(roundTrip(HAIRCUT, () => undefined)).toBeNull();
  });

  it('enthält nur geänderte Felder und immer die Terminart', () => {
    expect(
      roundTrip(YOGA, (v) => {
        v.defaultCapacity = '15';
        v.description = '';
        v.rules.minLeadMinutes = { useDefault: true, value: '' };
      }),
    ).toEqual({
      type: 'group',
      defaultCapacity: 15,
      description: null,
      bookingRules: { minLeadMinutes: null },
    });
    expect(
      roundTrip(HAIRCUT, (v) => {
        v.active = true;
        v.title = 'Herrenschnitt';
      }),
    ).toEqual({ type: 'single', active: true, title: 'Herrenschnitt' });
  });
});

describe('fieldErrorsFromPaths', () => {
  it('ordnet bekannte Pfade der API den Feldern zu und ignoriert unbekannte', () => {
    expect(fieldErrorsFromPaths(['title', 'bookingRules.horizonDays', 'type', ''])).toEqual({
      title: expect.any(String) as string,
      'bookingRules.horizonDays': expect.any(String) as string,
    });
  });
});
