import { MAX_AVAILABLE_DATES_RANGE_DAYS } from '@fw-booking/shared';
import type { PublicService, PublicSession } from '@fw-booking/shared';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { SELECT_EVENT } from './app.js';
import type { Selection } from './app.js';
import { install } from './bootstrap.js';
import { SESSION_WINDOW_DAYS } from './views/course.js';

const CAL = 'cal_AAAAAAAAAAAAAAAA';
const API = 'https://api.example.de';
const BASE = `${API}/api/public/calendars/${CAL}`;
const TZ = 'Europe/Berlin';
const YOGA = '66f1a2b3c4d5e6f708192a01';
const PILATES = '66f1a2b3c4d5e6f708192a02';
const HAIRCUT = '66f1a2b3c4d5e6f708192a03';
/** 2026-10-11 22:30 UTC ist in Berlin bereits der 12.10. */
const NOW = new Date('2026-10-11T22:30:00Z');

type TestWindow = Window & typeof globalThis;
type Handler = (url: URL, init: RequestInit | undefined) => Promise<Response> | Response;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function service(id: string, title: string, type: 'single' | 'group' = 'group'): PublicService {
  return { id, title, type, description: null, durationMinutes: 60 };
}

function session(id: string, startsAt: string, freeSeats: number, location: string | null = null) {
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60_000).toISOString().replace('.000', '');
  return { id, serviceId: YOGA, startsAt, endsAt, freeSeats, location } satisfies PublicSession;
}

function sessionsResponse(sessions: PublicSession[], serviceId = YOGA) {
  return json({ serviceId, timeZone: TZ, sessions });
}

/** Fetch-Attrappe, die Anfragen nach Pfad beantwortet und alle Aufrufe festhält. */
function router(routes: Record<string, Handler | Handler[]>) {
  const calls: { url: URL; signal: AbortSignal | null }[] = [];
  const counters = new Map<string, number>();
  const fetchMock: typeof fetch = (input, init) => {
    const url = new URL(input as string);
    calls.push({ url, signal: init?.signal ?? null });
    const path = url.pathname.slice(new URL(BASE).pathname.length);
    const route = routes[path];
    if (!route) return Promise.resolve(json({ statusCode: 404, message: 'Nicht gefunden' }, 404));
    const n = counters.get(path) ?? 0;
    counters.set(path, n + 1);
    const handler = Array.isArray(route)
      ? (route[Math.min(n, route.length - 1)] as Handler)
      : route;
    return Promise.resolve(handler(url, init));
  };
  return { fetchMock, calls };
}

async function mount(routes: Record<string, Handler | Handler[]>, attrs = '') {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="w" data-fw-booking-calendar="${CAL}" data-fw-booking-api="${API}" ${attrs}></div></body></html>`,
  );
  const win = dom.window as unknown as TestWindow;
  if (win.document.readyState === 'loading') {
    await new Promise((resolve) => {
      win.document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  const { fetchMock, calls } = router(routes);
  const api = install(win, { fetch: fetchMock, now: () => NOW, autoScan: false });
  const container = win.document.getElementById('w');
  if (!container) throw new Error('Container fehlt');
  const events: (Selection | null)[] = [];
  container.addEventListener(SELECT_EVENT, (event) => {
    events.push((event as CustomEvent<Selection | null>).detail);
  });
  const instance = api.mount(container);
  const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
  const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
  const text = (selector: string) => $$(selector).map((node) => node.textContent);
  return { win, api, container, instance, calls, events, $, $$, text };
}

const twoCourses = {
  '/services': () =>
    json({ timeZone: TZ, services: [service(YOGA, 'Yoga'), service(PILATES, 'Pilates')] }),
};

function click(node: HTMLElement | null) {
  if (!node) throw new Error('Element fehlt');
  node.click();
}

describe('Angebote', () => {
  it('zeigt während des Ladens einen Status', async () => {
    const w = await mount({ '/services': () => new Promise<Response>(() => undefined) });
    expect(w.$('[role="status"]')?.textContent).toBe('Buchungskalender wird geladen …');
  });

  it('zeigt mehrere Angebote zur Auswahl', async () => {
    const w = await mount(twoCourses);
    await vi.waitFor(() => {
      expect(w.text('.fw-booking-service-name')).toEqual(['Yoga', 'Pilates']);
    });
    expect(w.$('.fw-booking-services-title')?.textContent).toBe('Angebot auswählen');
    expect(w.text('.fw-booking-service-meta')).toEqual(['60 Min.', '60 Min.']);
    for (const node of w.$$('button')) expect(node.getAttribute('type')).toBe('button');
  });

  it('zeigt einen Hinweis, wenn keine Angebote buchbar sind', async () => {
    const w = await mount({ '/services': () => json({ timeZone: TZ, services: [] }) });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message--info')?.textContent).toBe(
        'Derzeit sind keine Angebote buchbar.',
      );
    });
  });

  it('zeigt Ladefehler mit erneutem Versuch', async () => {
    const w = await mount({
      '/services': [
        () => Promise.reject(new TypeError('Failed to fetch')),
        twoCourses['/services'],
      ],
    });
    await vi.waitFor(() => {
      expect(w.$('[role="alert"] .fw-booking-message-text')?.textContent).toBe(
        'Der Buchungskalender ist gerade nicht erreichbar. Bitte versuche es später erneut.',
      );
    });
    click(w.$('.fw-booking-retry'));
    await vi.waitFor(() => {
      expect(w.text('.fw-booking-service-name')).toEqual(['Yoga', 'Pilates']);
    });
  });

  it.each([
    [json({ statusCode: 404, message: 'x' }, 404), 'Dieser Buchungskalender wurde nicht gefunden.'],
    [
      json({ statusCode: 429, message: 'x', code: 'rate_limited' }, 429, { 'Retry-After': '30' }),
      'Zu viele Anfragen. Bitte versuche es in 30 Sekunden erneut.',
    ],
    [
      json({ statusCode: 500, message: 'intern' }, 500),
      'Die Termine konnten nicht geladen werden. Bitte versuche es erneut.',
    ],
  ])('übersetzt Fehlerantworten in verständliche Meldungen', async (response, message) => {
    const w = await mount({ '/services': () => response });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message-text')?.textContent).toBe(message);
    });
  });

  it('öffnet ein einzelnes Angebot direkt, ohne Zurück-Schaltfläche', async () => {
    const w = await mount({
      '/services': () => json({ timeZone: TZ, services: [service(YOGA, 'Yoga')] }),
      [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service-title')?.textContent).toBe('Yoga');
    });
    expect(w.$('.fw-booking-back')).toBeNull();
  });

  it('zeigt bei festem Angebot direkt dessen Kurstermine', async () => {
    const w = await mount(
      {
        ...twoCourses,
        [`/services/${PILATES}/sessions`]: () =>
          sessionsResponse([session('a1', '2026-10-13T08:00:00Z', 4)], PILATES),
      },
      `data-fw-booking-service="${PILATES}"`,
    );
    await vi.waitFor(() => {
      expect(w.text('.fw-booking-session-time')).toEqual(['10:00–11:00']);
    });
    expect(w.$('.fw-booking-service-title')?.textContent).toBe('Pilates');
    expect(w.$('.fw-booking-back')).toBeNull();
  });

  it('meldet ein festes Angebot, das nicht (mehr) buchbar ist', async () => {
    const w = await mount(twoCourses, `data-fw-booking-service="${HAIRCUT}"`);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message--info')?.textContent).toBe(
        'Dieses Angebot ist derzeit nicht buchbar.',
      );
    });
  });

  it('zeigt für Einzeltermine vorerst einen Hinweis', async () => {
    const w = await mount({
      '/services': () =>
        json({ timeZone: TZ, services: [service(HAIRCUT, 'Haarschnitt', 'single')] }),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-single .fw-booking-message--info')?.textContent).toBe(
        'Die Terminauswahl für dieses Angebot folgt in Kürze.',
      );
    });
    expect(w.calls.map((c) => c.url.pathname)).toEqual([new URL(`${BASE}/services`).pathname]);
  });
});

describe('Kursansicht', () => {
  it('lädt die nächsten 62 Tage ab heute in der Zeitzone der Installation', async () => {
    expect(SESSION_WINDOW_DAYS).toBe(MAX_AVAILABLE_DATES_RANGE_DAYS);
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service-name')).not.toBeNull();
    });
    click(w.$$('.fw-booking-service')[0] ?? null);
    await vi.waitFor(() => {
      expect(w.calls).toHaveLength(2);
    });
    const url = w.calls[1]?.url;
    expect(url?.pathname).toBe(new URL(`${BASE}/services/${YOGA}/sessions`).pathname);
    expect(url?.searchParams.get('from')).toBe('2026-10-12');
    expect(url?.searchParams.get('to')).toBe('2026-12-12');
  });

  it('zeigt Kurstermine nach Tagen mit Uhrzeit, Ort und freien Plätzen', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () =>
        sessionsResponse([
          session('s1', '2026-10-12T16:00:00Z', 3, 'Studio 1'),
          session('s2', '2026-10-12T18:00:00Z', 1),
          // 23:30 Berlin am 13.10. (Sommerzeit, UTC+2)
          session('s3', '2026-10-13T21:30:00Z', 0, 'Studio 2'),
          // nach der Zeitumstellung am 25.10. gilt UTC+1
          session('s4', '2026-10-26T09:00:00Z', 12),
        ]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(4);
    });

    expect(w.text('.fw-booking-day-title')).toEqual([
      'Mo., 12. Okt. 2026',
      'Di., 13. Okt. 2026',
      'Mo., 26. Okt. 2026',
    ]);
    expect(w.$$('.fw-booking-day').map((day) => day.querySelectorAll('li').length)).toEqual([
      2, 1, 1,
    ]);
    expect(w.text('.fw-booking-session-time')).toEqual([
      '18:00–19:00',
      '20:00–21:00',
      '23:30–00:30',
      '10:00–11:00',
    ]);
    expect(w.text('.fw-booking-session-location')).toEqual(['Studio 1', 'Studio 2']);
    expect(w.text('.fw-booking-session-seats')).toEqual([
      '3 Plätze frei',
      '1 Platz frei',
      'Ausgebucht',
      '12 Plätze frei',
    ]);
    // Sichtbarer Text mit Trennern, auch ohne Styling lesbar.
    expect(w.$$('.fw-booking-session').map((node) => node.textContent)).toEqual([
      '18:00–19:00 · Studio 1 · 3 Plätze frei',
      '20:00–21:00 · 1 Platz frei',
      '23:30–00:30 · Studio 2 · Ausgebucht',
      '10:00–11:00 · 12 Plätze frei',
    ]);
    for (const separator of w.$$('.fw-booking-separator')) {
      expect(separator.getAttribute('aria-hidden')).toBe('true');
    }
    expect(w.$$('.fw-booking-session')[0]?.getAttribute('aria-label')).toBe(
      'Mo., 12. Okt. 2026, 18:00–19:00, Studio 1, 3 Plätze frei',
    );
    expect(w.$('.fw-booking-sessions-status')?.textContent).toBe('');
    expect(w.$('.fw-booking-more')?.hidden).toBe(false);
  });

  it('kennzeichnet ausgebuchte Termine und macht sie nicht wählbar', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () =>
        sessionsResponse([session('full', '2026-10-12T16:00:00Z', 0)]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session--full')).not.toBeNull();
    });
    const full = w.$('.fw-booking-session--full') as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    full.click();
    expect(w.events).toEqual([]);
    expect(w.instance.selection).toBeNull();
  });

  it('zeigt einen Leerzustand ohne Kurstermine', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message--info')?.textContent).toBe(
        'Derzeit sind keine Kurstermine buchbar.',
      );
    });
    expect(w.$('.fw-booking-more')?.hidden).toBe(true);
  });

  it('zeigt den Ladezustand der Kurstermine', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () => new Promise<Response>(() => undefined),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    expect(w.$('.fw-booking-sessions-status [role="status"]')?.textContent).toBe(
      'Kurstermine werden geladen …',
    );
    expect(w.$('.fw-booking-more')?.hidden).toBe(true);
  });

  it('lädt weitere Zeiträume nach und beendet die Liste bei einem leeren Zeitraum', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: [
        () => sessionsResponse([session('s1', '2026-12-12T09:00:00Z', 2)]),
        () => sessionsResponse([session('s2', '2026-12-13T09:00:00Z', 5)]),
        () => sessionsResponse([]),
      ],
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(1);
    });

    const more = w.$('.fw-booking-more') as HTMLButtonElement;
    expect(more.textContent).toBe('Weitere Termine');
    more.click();
    expect(more.disabled).toBe(true);
    expect(more.textContent).toBe('Lädt …');
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(2);
    });
    const windows = w.calls
      .slice(1)
      .map((c) => [c.url.searchParams.get('from'), c.url.searchParams.get('to')]);
    expect(windows).toEqual([
      ['2026-10-12', '2026-12-12'],
      ['2026-12-13', '2027-02-12'],
    ]);

    more.click();
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message--info')?.textContent).toBe(
        'Keine weiteren Kurstermine im Buchungszeitraum.',
      );
    });
    expect(more.hidden).toBe(true);
    expect(w.$$('.fw-booking-session')).toHaveLength(2);
  });

  it('zeigt Fehler beim Laden der Kurstermine mit erneutem Versuch', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: [
        () => json({ statusCode: 500, message: 'intern' }, 500),
        () => sessionsResponse([session('s1', '2026-10-12T16:00:00Z', 2)]),
      ],
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-sessions-status [role="alert"]')).not.toBeNull();
    });
    expect(w.$('.fw-booking-more')?.hidden).toBe(true);
    click(w.$('.fw-booking-retry'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(1);
    });
    expect(w.$('[role="alert"]')).toBeNull();
    const froms = w.calls.slice(1).map((c) => c.url.searchParams.get('from'));
    expect(froms).toEqual(['2026-10-12', '2026-10-12']);
  });

  it('zeigt einen Zeitzonenhinweis nur bei abweichender Gerätezeitzone', async () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = device === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo';
    for (const [timeZone, expected] of [
      [device, null],
      [other, `Alle Zeiten in der Zeitzone ${other}.`],
    ] as const) {
      const w = await mount({
        '/services': () => json({ timeZone, services: [service(YOGA, 'Yoga')] }),
        [`/services/${YOGA}/sessions`]: () => sessionsResponse([]),
      });
      await vi.waitFor(() => {
        expect(w.$('.fw-booking-course')).not.toBeNull();
      });
      expect(w.$('.fw-booking-hint')?.textContent ?? null).toBe(expected);
    }
  });

  it('gibt Texte aus API-Daten nie als HTML aus', async () => {
    const evil = '<img src=x onerror="alert(1)"><b>fett</b>';
    const w = await mount({
      '/services': () =>
        json({
          timeZone: TZ,
          services: [{ ...service(YOGA, evil), description: evil }, service(PILATES, evil)],
        }),
      [`/services/${YOGA}/sessions`]: () =>
        sessionsResponse([session('s1', '2026-10-12T16:00:00Z', 2, evil)]),
    });
    await vi.waitFor(() => {
      expect(w.text('.fw-booking-service-name')).toEqual([evil, evil]);
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session-location')?.textContent).toBe(evil);
    });
    expect(w.$('.fw-booking-service-title')?.textContent).toBe(evil);
    expect(w.$('.fw-booking-service-description')?.textContent).toBe(evil);
    expect(w.container.querySelector('img, b')).toBeNull();
  });
});

describe('Auswahl', () => {
  async function courseWithSessions() {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () =>
        sessionsResponse([
          session('s1', '2026-10-12T16:00:00Z', 3),
          session('s2', '2026-10-13T16:00:00Z', 1),
        ]),
      [`/services/${PILATES}/sessions`]: () => sessionsResponse([], PILATES),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-session')).toHaveLength(2);
    });
    return w;
  }

  it('merkt den gewählten Termin und meldet ihn als Ereignis', async () => {
    const w = await courseWithSessions();
    const [first, second] = w.$$('.fw-booking-session');
    expect(first?.getAttribute('aria-pressed')).toBe('false');

    click(first ?? null);
    const expected: Selection = {
      type: 'group',
      calendarId: CAL,
      serviceId: YOGA,
      sessionId: 's1',
      startsAt: '2026-10-12T16:00:00Z',
      endsAt: '2026-10-12T17:00:00Z',
      timeZone: TZ,
    };
    expect(w.instance.selection).toEqual(expected);
    expect(w.events).toEqual([expected]);
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(first?.classList.contains('fw-booking-session--selected')).toBe(true);

    click(second ?? null);
    expect(w.instance.selection?.sessionId).toBe('s2');
    expect(first?.getAttribute('aria-pressed')).toBe('false');
    expect(second?.getAttribute('aria-pressed')).toBe('true');
    expect(w.events.map((e) => e?.sessionId)).toEqual(['s1', 's2']);
  });

  it('löst das Ereignis bubbelnd am Container aus', async () => {
    const w = await courseWithSessions();
    const received: unknown[] = [];
    w.win.document.body.addEventListener(SELECT_EVENT, (event) => {
      received.push((event as CustomEvent).detail);
    });
    click(w.$('.fw-booking-session'));
    expect(received).toHaveLength(1);
  });

  it('setzt die Auswahl beim Wechsel zur Angebotsliste zurück', async () => {
    const w = await courseWithSessions();
    click(w.$('.fw-booking-session'));
    click(w.$('.fw-booking-back'));
    expect(w.text('.fw-booking-service-name')).toEqual(['Yoga', 'Pilates']);
    expect(w.instance.selection).toBeNull();
    expect(w.events.at(-1)).toBeNull();
  });
});

describe('Abbruch', () => {
  it('bricht laufende Anfragen beim Verlassen der Ansicht und beim Entfernen ab', async () => {
    const w = await mount({
      ...twoCourses,
      [`/services/${YOGA}/sessions`]: () => new Promise<Response>(() => undefined),
      [`/services/${PILATES}/sessions`]: () => new Promise<Response>(() => undefined),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.calls).toHaveLength(2);
    });
    click(w.$('.fw-booking-back'));
    expect(w.calls[1]?.signal?.aborted).toBe(true);

    click(w.$$('.fw-booking-service')[1] ?? null);
    await vi.waitFor(() => {
      expect(w.calls).toHaveLength(3);
    });
    expect(w.calls[2]?.signal?.aborted).toBe(false);
    w.api.unmount(w.container);
    expect(w.calls[2]?.signal?.aborted).toBe(true);
    expect(w.container.childElementCount).toBe(0);
  });

  it('ignoriert Antworten, die nach dem Entfernen eintreffen', async () => {
    let answer: (response: Response) => void = () => undefined;
    const w = await mount({
      '/services': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const root = w.instance.root;
    w.api.unmount(w.container);
    answer(json({ timeZone: TZ, services: [service(YOGA, 'Yoga'), service(PILATES, 'P')] }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.querySelector('.fw-booking-service')).toBeNull();
  });
});
