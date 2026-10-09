import type { SelfServiceBooking } from '@fw-booking/shared';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { install } from '../bootstrap.js';
import {
  API,
  CAL,
  HAIRCUT,
  NOW,
  TZ,
  YOGA,
  click,
  datesResponse,
  json,
  router,
  service,
  session,
  sessionsResponse,
  slot,
  slotsResponse,
} from '../test-utils.js';
import type { Handler } from '../test-utils.js';
import { CANCELLED_EVENT, REBOOKED_EVENT } from './manage-app.js';
import type { ManageEventDetail } from './manage-app.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const PAGE = 'https://kunde.example.de/termine/';
const M = '/api/public/manage';

type TestWindow = Window & typeof globalThis;

function booking(overrides: Partial<SelfServiceBooking> = {}): SelfServiceBooking {
  return {
    type: 'group',
    serviceTitle: 'Yoga',
    participantName: 'Erika Mustermann',
    startsAt: '2026-10-12T16:00:00Z',
    endsAt: '2026-10-12T17:00:00Z',
    timeZone: TZ,
    location: 'Studio 1',
    status: 'confirmed',
    changeDeadline: '2026-10-11T16:00:00Z',
    canCancel: true,
    canRebook: true,
    ...overrides,
  };
}

function container(extra = ''): string {
  return `<div data-fw-booking-calendar="${CAL}" data-fw-booking-api="${API}" data-fw-booking-privacy-url="https://example.de/datenschutz" ${extra}></div>`;
}

async function page(
  routes: Record<string, Handler | Handler[]>,
  options: { body?: string; hash?: string } = {},
) {
  const dom = new JSDOM(
    `<!doctype html><html><body>${options.body ?? container('id="w"')}</body></html>`,
    { url: `${PAGE}${options.hash ?? `#t=${TOKEN}`}` },
  );
  const win = dom.window as unknown as TestWindow;
  const { fetchMock, calls } = router(routes);
  // Wie das echte Script: install() läuft, bevor die Seite fertig geladen ist.
  const api = install(win, { fetch: fetchMock, now: () => NOW });
  if (win.document.readyState === 'loading') {
    await new Promise((resolve) => {
      win.document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  const events: { type: string; detail: ManageEventDetail }[] = [];
  for (const type of [CANCELLED_EVENT, REBOOKED_EVENT]) {
    win.document.addEventListener(type, (event) => {
      events.push({ type, detail: (event as CustomEvent<ManageEventDetail>).detail });
    });
  }
  const c = win.document.getElementById('w') ?? win.document.body;
  const $ = (selector: string) => c.querySelector<HTMLElement>(selector);
  const $$ = (selector: string) => [...c.querySelectorAll<HTMLElement>(selector)];
  const text = (selector: string) => $$(selector).map((node) => node.textContent);
  return { win, api, calls, events, $, $$, text, container: c };
}

const view =
  (b: SelfServiceBooking = booking()): Handler =>
  () =>
    json(b);

describe('Verwaltungslink', () => {
  it('liest das Token, entfernt es aus der Adresse und sendet es nur im Header', async () => {
    const w = await page({ [M]: view() });
    expect(w.win.location.href).toBe(PAGE);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage')).not.toBeNull();
    });
    const [call] = w.calls;
    expect(call?.url.href).toBe(`${API}${M}`);
    expect(call?.headers['X-Booking-Token']).toBe(TOKEN);
    for (const c of w.calls) expect(c.url.href).not.toContain(TOKEN);
  });

  it('zeigt die Verwaltung im markierten Container, andere Container buchen normal', async () => {
    const w = await page(
      {
        [M]: view(),
        '/services': () => json({ timeZone: TZ, services: [service(YOGA, 'Yoga')] }),
        [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
      },
      { body: container('id="a"') + container('id="b" data-fw-booking-manage') },
    );
    const a = w.win.document.getElementById('a');
    const b = w.win.document.getElementById('b');
    await vi.waitFor(() => {
      expect(b?.querySelector('.fw-booking-manage')).not.toBeNull();
      expect(a?.querySelector('.fw-booking-course')).not.toBeNull();
    });
    expect(a?.querySelector('.fw-booking-manage')).toBeNull();
  });

  it('nimmt ohne Markierung den ersten Container und vergibt das Token nur einmal', async () => {
    const w = await page(
      {
        [M]: view(),
        '/services': () => json({ timeZone: TZ, services: [service(YOGA, 'Yoga')] }),
        [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
      },
      { body: container('id="a"') + container('id="b"') },
    );
    const a = w.win.document.getElementById('a');
    const b = w.win.document.getElementById('b');
    await vi.waitFor(() => {
      expect(a?.querySelector('.fw-booking-manage')).not.toBeNull();
      expect(b?.querySelector('.fw-booking-course')).not.toBeNull();
    });
    if (!a) throw new Error();
    w.api.unmount(a);
    w.api.mount(a);
    await vi.waitFor(() => {
      expect(a.querySelector('.fw-booking-course')).not.toBeNull();
    });
    expect(w.calls.filter((c) => c.url.pathname === M)).toHaveLength(1);
  });

  it('zeigt Angebot, Termin, Name, Ort, Status, Frist und Aktionen', async () => {
    const w = await page({ [M]: view() });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage')).not.toBeNull();
    });
    await Promise.resolve();
    expect(w.win.document.activeElement?.textContent).toBe('Deine Buchung');
    expect(w.$('.fw-booking-summary')?.textContent).toBe('Yoga · Mo., 12. Okt. 2026 · 18:00–19:00');
    expect(w.text('.fw-booking-detail-label')).toEqual(['Gebucht für', 'Ort', 'Status']);
    expect(w.text('.fw-booking-detail-value')).toEqual([
      'Erika Mustermann',
      'Studio 1',
      'Bestätigt',
    ]);
    expect(w.$('.fw-booking-manage > .fw-booking-hint')?.textContent).toBe(
      'Änderungen über diesen Link sind bis So., 11. Okt. 2026, 18:00 möglich.',
    );
    expect(w.text('.fw-booking-manage-actions button')).toEqual([
      'Termin umbuchen',
      'Termin stornieren',
    ]);
    expect(w.$('.fw-booking-reload-hint')?.textContent).toContain('Neuladen der Seite');
  });

  it.each([
    [
      'nach einer Umbuchung',
      { canRebook: false },
      'Änderungen über diesen Link sind bis So., 11. Okt. 2026, 18:00 möglich. Dieser Termin wurde bereits einmal umgebucht; eine Stornierung ist weiterhin möglich.',
      ['Termin stornieren'],
    ],
    [
      'nach Ablauf der Frist',
      { canRebook: false, canCancel: false },
      'Änderungen über diesen Link sind nicht mehr möglich. Bitte wende dich bei Fragen direkt an uns.',
      [],
    ],
  ])('zeigt passende Hinweise %s', async (_name, overrides, hint, actions) => {
    const w = await page({ [M]: view(booking(overrides)) });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage')).not.toBeNull();
    });
    expect(w.$('.fw-booking-manage > .fw-booking-hint')?.textContent).toBe(hint);
    expect(w.text('.fw-booking-manage-actions button')).toEqual(actions);
  });

  it.each([
    ['cancelled', 'Storniert'],
    ['rebooked', 'Umgebucht'],
    ['cancelled_by_owner', 'Vom Anbieter abgesagt'],
  ] as const)('zeigt Status %s ohne Änderungsaktionen', async (status, label) => {
    const w = await page({
      [M]: view(booking({ status, canCancel: false, canRebook: false })),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage')).not.toBeNull();
    });
    expect(w.text('.fw-booking-detail-value').at(-1)).toBe(label);
    expect(w.text('.fw-booking-manage-actions button')).toEqual(['Neuen Termin buchen']);
  });

  it('meldet ungültige Tokens ohne Anfrage', async () => {
    const w = await page({}, { hash: '#t=kurz' });
    expect(w.win.location.href).toBe(PAGE);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message-text')?.textContent).toBe(
        'Dieser Verwaltungslink ist ungültig oder nicht mehr aktuell. Bitte nutze den Link aus deiner neuesten E-Mail.',
      );
    });
    expect(w.calls).toEqual([]);
  });

  it.each([
    [404, {}, 'Dieser Verwaltungslink ist ungültig', false],
    [410, { code: 'link_expired' }, 'Dieser Verwaltungslink ist abgelaufen', false],
    [500, {}, 'Die Termine konnten nicht geladen werden', true],
  ])('zeigt Ladefehler %i passend an', async (status, body, message, retry) => {
    const w = await page({
      [M]: () => json({ statusCode: status, message: 'x', ...body }, status),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message-text')?.textContent).toContain(message);
    });
    expect(w.$('.fw-booking-retry') !== null).toBe(retry);
  });

  it('gibt Daten der Buchung nie als HTML aus', async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const w = await page({
      [M]: view(booking({ participantName: evil, serviceTitle: evil, location: evil })),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage')).not.toBeNull();
    });
    expect(w.text('.fw-booking-detail-value').slice(0, 2)).toEqual([evil, evil]);
    expect(w.container.querySelector('img')).toBeNull();
  });
});

describe('Storno über den Verwaltungslink', () => {
  async function openCancel(routes: Record<string, Handler | Handler[]> = {}) {
    const w = await page({ [M]: view(), ...routes });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-cancel')).not.toBeNull();
    });
    click(w.$('.fw-booking-cancel'));
    return w;
  }

  it('verlangt eine Bestätigung; Abbrechen ändert nichts', async () => {
    const w = await openCancel();
    expect(w.$('.fw-booking-confirm-title')?.textContent).toBe(
      'Möchtest du diesen Termin wirklich stornieren?',
    );
    await Promise.resolve();
    expect(w.win.document.activeElement?.textContent).toBe(
      'Möchtest du diesen Termin wirklich stornieren?',
    );
    // Abbrechen steht vor der bestätigenden Schaltfläche.
    expect(w.text('.fw-booking-manage-actions button')).toEqual(['Abbrechen', 'Ja, stornieren']);
    expect(w.$('.fw-booking-confirm')?.classList.contains('fw-booking-confirm--danger')).toBe(true);
    click(w.$('.fw-booking-abort'));
    expect(w.$('.fw-booking-manage')).not.toBeNull();
    expect(w.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('storniert nach Bestätigung genau einmal und meldet das Ergebnis', async () => {
    let answer: (r: Response) => void = () => undefined;
    const w = await openCancel({
      [`${M}/cancel`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      '/services': () => json({ timeZone: TZ, services: [service(YOGA, 'Yoga')] }),
      [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
    });
    click(w.$('.fw-booking-confirm'));
    click(w.$('.fw-booking-confirm'));
    const posts = w.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url.href).toBe(`${API}${M}/cancel`);
    expect(JSON.parse(posts[0]?.body ?? '')).toEqual({ confirm: true });
    expect(posts[0]?.headers['X-Booking-Token']).toBe(TOKEN);
    expect((w.$('.fw-booking-abort') as HTMLButtonElement).disabled).toBe(true);
    expect(w.$('.fw-booking-confirm')?.textContent).toBe('Wird ausgeführt …');

    answer(
      json({
        ...booking({ status: 'cancelled', canCancel: false, canRebook: false }),
        alreadyCancelled: false,
      }),
    );
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation-title')?.textContent).toBe('Dein Termin ist storniert');
    });
    expect(w.$('.fw-booking-confirmation-mail')?.textContent).toBe(
      'Du erhältst gleich eine Bestätigung per E-Mail.',
    );
    expect(w.events).toEqual([
      {
        type: CANCELLED_EVENT,
        detail: {
          calendarId: CAL,
          type: 'group',
          serviceTitle: 'Yoga',
          startsAt: '2026-10-12T16:00:00Z',
          endsAt: '2026-10-12T17:00:00Z',
          timeZone: TZ,
        },
      },
    ]);
    expect(JSON.stringify(w.events)).not.toContain('Erika');
    expect(JSON.stringify(w.events)).not.toContain(TOKEN);

    // Danach normal buchen im selben Container.
    click(w.$('.fw-booking-book-another'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-course')).not.toBeNull();
    });
  });

  it('zeigt Fehler im Bestätigungsschritt und erlaubt einen neuen Versuch', async () => {
    const w = await openCancel({
      [`${M}/cancel`]: () =>
        json({ statusCode: 409, message: 'x', code: 'change_deadline_passed' }, 409),
    });
    click(w.$('.fw-booking-confirm'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-form-status')?.textContent).toBe(
        'Änderungen über diesen Link sind nicht mehr möglich. Bitte wende dich bei Fragen direkt an uns.',
      );
    });
    expect((w.$('.fw-booking-confirm') as HTMLButtonElement).disabled).toBe(false);
    expect(w.$('.fw-booking-confirm')?.textContent).toBe('Ja, stornieren');
  });

  it('bricht eine laufende Anfrage beim Entfernen ab', async () => {
    const w = await openCancel({
      [`${M}/cancel`]: () => new Promise<Response>(() => undefined),
    });
    click(w.$('.fw-booking-confirm'));
    w.api.unmount(w.container);
    expect(w.calls.find((c) => c.method === 'POST')?.signal?.aborted).toBe(true);
  });
});

describe('Umbuchung über den Verwaltungslink', () => {
  it('bucht einen Kursplatz nach Bestätigung um', async () => {
    const w = await page({
      [M]: view(),
      [`${M}/sessions`]: () =>
        sessionsResponse([
          session('s2', '2026-10-14T16:00:00Z', 3, 'Studio 2'),
          session('s3', '2026-10-19T16:00:00Z', 0),
        ]),
      [`${M}/rebook`]: () =>
        json({
          ...booking({
            startsAt: '2026-10-14T16:00:00Z',
            endsAt: '2026-10-14T17:00:00Z',
            canRebook: false,
          }),
          alreadyRebooked: false,
        }),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-rebook')).not.toBeNull();
    });
    click(w.$('.fw-booking-rebook'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(2);
    });
    expect(w.$('.fw-booking-manage-rebook .fw-booking-hint')?.textContent).toBe(
      'Bisher: Yoga · Mo., 12. Okt. 2026 · 18:00–19:00',
    );
    const sessionsCall = w.calls.find((c) => c.url.pathname === `${M}/sessions`);
    expect(sessionsCall?.url.searchParams.get('from')).toBe('2026-10-12');
    expect(sessionsCall?.headers['X-Booking-Token']).toBe(TOKEN);
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(true);

    click(w.$('.fw-booking-session'));
    expect(w.$('.fw-booking-chosen')?.textContent).toBe(
      'Gewählt: Yoga · Mi., 14. Okt. 2026 · 18:00–19:00',
    );
    click(w.$('.fw-booking-continue'));
    expect(w.$('.fw-booking-confirm-title')?.textContent).toBe(
      'Möchtest du deinen Termin wirklich umbuchen?',
    );
    expect(w.text('.fw-booking-detail-value')).toEqual([
      'Yoga · Mo., 12. Okt. 2026 · 18:00–19:00',
      'Yoga · Mi., 14. Okt. 2026 · 18:00–19:00',
    ]);
    click(w.$('.fw-booking-confirm'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation-title')?.textContent).toBe('Dein Termin ist umgebucht');
    });
    const post = w.calls.find((c) => c.method === 'POST');
    expect(JSON.parse(post?.body ?? '')).toEqual({
      type: 'group',
      sessionId: 's2',
      confirm: true,
    });
    expect(w.events.map((e) => [e.type, e.detail.startsAt])).toEqual([
      [REBOOKED_EVENT, '2026-10-14T16:00:00Z'],
    ]);
    // Zurück zur Übersicht lädt die Buchung neu (der Link bleibt gültig).
    click(w.$('.fw-booking-back-to-booking'));
    await vi.waitFor(() => {
      expect(w.calls.filter((c) => c.url.pathname === M)).toHaveLength(2);
    });
  });

  it('nutzt für Einzeltermine Kalender und Uhrzeiten des Verwaltungslinks', async () => {
    const single = booking({
      type: 'single',
      serviceTitle: 'Haarschnitt',
      startsAt: '2026-10-14T07:00:00Z',
      endsAt: '2026-10-14T07:30:00Z',
      location: null,
    });
    const w = await page({
      [M]: view(single),
      [`${M}/available-dates`]: () => datesResponse(['2026-10-14', '2026-10-15']),
      [`${M}/slots`]: (url) =>
        slotsResponse([slot(`${url.searchParams.get('date') ?? ''}T08:00:00Z`)]),
      [`${M}/rebook`]: () => json({ ...single, alreadyRebooked: false }),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-rebook')).not.toBeNull();
    });
    click(w.$('.fw-booking-rebook'));
    // Bevorzugt der Tag der bisherigen Buchung.
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots-title')?.textContent).toBe('Mittwoch, 14. Oktober 2026');
    });
    const paths = w.calls.map((c) => `${c.url.pathname}${c.url.search}`);
    expect(paths).toContain(`${M}/available-dates?from=2026-10-12&to=2026-10-31`);
    expect(paths).toContain(`${M}/slots?date=2026-10-14`);
    expect(paths.some((p) => p.includes(HAIRCUT) || p.includes('/services/'))).toBe(false);
    click(w.$('.fw-booking-slot'));
    click(w.$('.fw-booking-continue'));
    click(w.$('.fw-booking-confirm'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    expect(JSON.parse(w.calls.find((c) => c.method === 'POST')?.body ?? '')).toEqual({
      type: 'single',
      startsAt: '2026-10-14T08:00:00Z',
      confirm: true,
    });
  });

  it('führt bei vergebenem Ziel mit Hinweis zur frisch geladenen Auswahl zurück', async () => {
    const w = await page({
      [M]: view(),
      [`${M}/sessions`]: () => sessionsResponse([session('s2', '2026-10-14T16:00:00Z', 1)]),
      [`${M}/rebook`]: () => json({ statusCode: 409, message: 'x', code: 'session_full' }, 409),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-rebook')).not.toBeNull();
    });
    click(w.$('.fw-booking-rebook'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session')).not.toBeNull();
    });
    click(w.$('.fw-booking-session'));
    click(w.$('.fw-booking-continue'));
    click(w.$('.fw-booking-confirm'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage-rebook > .fw-booking-message--warning')?.textContent).toBe(
        'Dieser Kurstermin ist inzwischen ausgebucht. Bitte wähle einen anderen.',
      );
    });
    expect(w.calls.filter((c) => c.url.pathname === `${M}/sessions`).map((c) => c.cache)).toEqual([
      null,
      'reload',
    ]);
  });

  it('führt mit „Abbrechen“ zur Auswahl und mit „Zurück zu deiner Buchung“ zur Übersicht', async () => {
    const w = await page({
      [M]: view(),
      [`${M}/sessions`]: () => sessionsResponse([session('s2', '2026-10-14T16:00:00Z', 1)]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-rebook')).not.toBeNull();
    });
    click(w.$('.fw-booking-rebook'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session')).not.toBeNull();
    });
    click(w.$('.fw-booking-session'));
    click(w.$('.fw-booking-continue'));
    click(w.$('.fw-booking-abort'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-manage-rebook')).not.toBeNull();
    });
    click(w.$('.fw-booking-back'));
    expect(w.$('.fw-booking-manage')).not.toBeNull();
    expect(w.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});
