import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const CALENDAR_ID = 'cal_AbCdEfGhIjKlMnOp';

const PRIVACY = 'https://example.de/datenschutz';

/** Container mit den Attributen; die Datenschutzadresse wird ergänzt, sofern nicht angegeben. */
function container(attributes: Record<string, string>, withPrivacy = true): HTMLElement {
  const el = document.createElement('div');
  if (withPrivacy && !('data-fw-booking-privacy-url' in attributes)) {
    el.setAttribute('data-fw-booking-privacy-url', PRIVACY);
  }
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
      config: {
        calendarId: CALENDAR_ID,
        apiUrl: 'https://buchung.example.de',
        serviceId: null,
        privacyUrl: PRIVACY,
      },
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
      config: {
        calendarId: CALENDAR_ID,
        apiUrl: 'https://example.de/buchung',
        serviceId: null,
        privacyUrl: PRIVACY,
      },
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

  it('liest ein optional festgelegtes Angebot', () => {
    const result = readConfig(
      container({
        'data-fw-booking-calendar': CALENDAR_ID,
        'data-fw-booking-api': 'https://x.de',
        'data-fw-booking-service': '66f1a2b3c4d5e6f708192a3b',
      }),
    );
    expect(result).toEqual({
      ok: true,
      config: {
        calendarId: CALENDAR_ID,
        apiUrl: 'https://x.de',
        serviceId: '66f1a2b3c4d5e6f708192a3b',
        privacyUrl: PRIVACY,
      },
    });
  });

  it('behandelt ein leeres Angebotsattribut wie ein fehlendes', () => {
    const result = readConfig(
      container({
        'data-fw-booking-calendar': CALENDAR_ID,
        'data-fw-booking-api': 'https://x.de',
        'data-fw-booking-service': ' ',
      }),
    );
    expect(result).toMatchObject({ ok: true, config: { serviceId: null } });
  });

  it.each(['yoga', '66F1A2B3C4D5E6F708192A3B', '66f1a2b3c4d5e6f708192a3', '<b>x</b>'])(
    'lehnt die Angebots-ID %s ab',
    (serviceId) => {
      const result = readConfig(
        container({
          'data-fw-booking-calendar': CALENDAR_ID,
          'data-fw-booking-api': 'https://x.de',
          'data-fw-booking-service': serviceId,
        }),
      );
      expect(result).toEqual({
        ok: false,
        reason: 'data-fw-booking-service ist keine gültige Angebots-ID',
      });
    },
  );

  it('löst eine relative Datenschutzadresse gegen die Seite auf und behält Query und Fragment', () => {
    const result = readConfig(
      container({
        'data-fw-booking-calendar': CALENDAR_ID,
        'data-fw-booking-api': 'https://x.de',
        'data-fw-booking-privacy-url': '/?page_id=3#cookies',
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      config: { privacyUrl: new URL('/?page_id=3#cookies', document.baseURI).href },
    });
  });

  it.each([
    ['fehlende Datenschutzadresse', undefined],
    ['leere Datenschutzadresse', ' '],
    ['javascript-Adresse', 'javascript:alert(1)'],
    ['mailto-Adresse', 'mailto:datenschutz@example.de'],
  ])('lehnt %s ab', (_name, privacy) => {
    const attributes: Record<string, string> = {
      'data-fw-booking-calendar': CALENDAR_ID,
      'data-fw-booking-api': 'https://x.de',
    };
    if (privacy !== undefined) attributes['data-fw-booking-privacy-url'] = privacy;
    const result = readConfig(container(attributes, false));
    expect(result).toEqual({
      ok: false,
      reason: 'data-fw-booking-privacy-url fehlt oder ist keine http(s)-Adresse',
    });
  });
});
