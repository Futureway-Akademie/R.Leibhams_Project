import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const CALENDAR_ID = 'cal_AbCdEfGhIjKlMnOp';

function container(attributes: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return el;
}

describe('readConfig', () => {
  it('liest Kalenderkennung und API-Adresse aus den Datenattributen', () => {
    const result = readConfig(
      container({
        'data-fw-booking-calendar': CALENDAR_ID,
        'data-fw-booking-api': 'https://buchung.example.de/',
      }),
    );
    expect(result).toEqual({
      ok: true,
      config: { calendarId: CALENDAR_ID, apiUrl: 'https://buchung.example.de' },
    });
  });

  it('behält einen Pfad der API-Adresse und entfernt nur abschließende Schrägstriche', () => {
    const result = readConfig(
      container({
        'data-fw-booking-calendar': ` ${CALENDAR_ID} `,
        'data-fw-booking-api': 'https://example.de/buchung//',
      }),
    );
    expect(result).toEqual({
      ok: true,
      config: { calendarId: CALENDAR_ID, apiUrl: 'https://example.de/buchung' },
    });
  });

  it.each([
    ['fehlende Kennung', { 'data-fw-booking-api': 'https://example.de' }],
    [
      'Kennung ohne Präfix',
      { 'data-fw-booking-calendar': 'AbCdEfGhIjKlMnOp', 'data-fw-booking-api': 'https://x.de' },
    ],
    [
      'zu kurze Kennung',
      { 'data-fw-booking-calendar': 'cal_kurz', 'data-fw-booking-api': 'https://x.de' },
    ],
    [
      'Kennung mit Sonderzeichen',
      { 'data-fw-booking-calendar': `${CALENDAR_ID}<b>`, 'data-fw-booking-api': 'https://x.de' },
    ],
  ])('lehnt %s ab', (_name, attributes) => {
    const result = readConfig(container(attributes));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('calendar') as string });
  });

  it.each([
    ['fehlende Adresse', undefined],
    ['leere Adresse', '  '],
    ['relative Adresse', '/api'],
    ['javascript-Adresse', 'javascript:alert(1)'],
    ['Adresse mit Query', 'https://example.de/?x=1'],
    ['Adresse mit Fragment', 'https://example.de/#t'],
  ])('lehnt %s ab', (_name, api) => {
    const attributes: Record<string, string> = { 'data-fw-booking-calendar': CALENDAR_ID };
    if (api !== undefined) attributes['data-fw-booking-api'] = api;
    const result = readConfig(container(attributes));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('api') as string });
  });
});
