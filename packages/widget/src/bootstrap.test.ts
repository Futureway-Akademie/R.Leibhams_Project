import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIDGET_VERSION, install } from './bootstrap.js';
import { STATE_ATTRIBUTE } from './instance.js';

const CAL_A = 'cal_AAAAAAAAAAAAAAAA';
const CAL_B = 'cal_BBBBBBBBBBBBBBBB';
const API = 'https://api.example.de';

type TestWindow = Window & typeof globalThis;

/** Seite, deren Dokument fertig geladen ist (JSDOM meldet direkt nach dem Erzeugen `loading`). */
async function page(body: string): Promise<TestWindow> {
  const win = new JSDOM(`<!doctype html><html><body>${body}</body></html>`)
    .window as unknown as TestWindow;
  if (win.document.readyState === 'loading') {
    await new Promise((resolve) => {
      win.document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  return win;
}

function container(calendarId: string, extra = ''): string {
  return `<div data-fw-booking-calendar="${calendarId}" data-fw-booking-api="${API}" ${extra}></div>`;
}

function roots(win: TestWindow): HTMLElement[] {
  return [...win.document.querySelectorAll<HTMLElement>('.fw-booking-root')];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install', () => {
  it('initialisiert alle Container einer Seite unabhängig voneinander', async () => {
    const win = await page(container(CAL_A, 'id="a"') + container(CAL_B, 'id="b"'));
    const api = install(win);
    const a = win.document.getElementById('a');
    const b = win.document.getElementById('b');
    if (!a || !b) throw new Error('Container fehlen');

    const instanceA = api.mount(a);
    const instanceB = api.mount(b);
    expect(instanceA).not.toBe(instanceB);
    expect(instanceA.config).toEqual({ calendarId: CAL_A, apiUrl: API });
    expect(instanceB.config).toEqual({ calendarId: CAL_B, apiUrl: API });
    expect(instanceA.api).not.toBe(instanceB.api);
    expect(instanceA.root.parentElement).toBe(a);
    expect(instanceB.root.parentElement).toBe(b);
    expect(a.getAttribute(STATE_ATTRIBUTE)).toBe('ready');
    expect(b.getAttribute(STATE_ATTRIBUTE)).toBe('ready');

    // Entfernen einer Instanz lässt die andere unberührt.
    expect(api.unmount(a)).toBe(true);
    expect(a.childElementCount).toBe(0);
    expect(b.querySelector('.fw-booking-root')).toBe(instanceB.root);
  });

  it('jede Instanz fragt ihren eigenen Kalender ab', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{"timeZone":"Europe/Berlin","services":[]}')),
    );
    const win = await page(container(CAL_A, 'id="a"') + container(CAL_B, 'id="b"'));
    const api = install(win, { fetch: fetchMock, autoScan: false });
    const [a, b] = api.scan();
    await a?.api?.getServices();
    await b?.api?.getServices();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API}/api/public/calendars/${CAL_A}/services`,
      `${API}/api/public/calendars/${CAL_B}/services`,
    ]);
  });

  it('erkennt Container beim Laden automatisch', async () => {
    const win = await page(container(CAL_A) + '<p>Text</p>' + container(CAL_B));
    install(win);
    expect(roots(win)).toHaveLength(2);
  });

  it('wartet auf DOMContentLoaded, solange die Seite noch lädt', async () => {
    const win = await page(container(CAL_A));
    Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
    install(win);
    expect(roots(win)).toHaveLength(0);

    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    expect(roots(win)).toHaveLength(1);
    // Ein zweites Ereignis initialisiert nicht erneut.
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    expect(roots(win)).toHaveLength(1);
  });

  it('installiert sich bei mehrfacher Ausführung nur einmal', async () => {
    const win = await page(container(CAL_A) + container(CAL_B));
    const first = install(win);
    const second = install(win);
    expect(second).toBe(first);
    expect(win.FwBooking).toBe(first);
    expect(first.version).toBe(WIDGET_VERSION);
    expect(roots(win)).toHaveLength(2);
  });

  it('initialisiert bei erneutem Scan oder Mount keinen Container doppelt', async () => {
    const win = await page(container(CAL_A, 'id="a"'));
    const api = install(win);
    const a = win.document.getElementById('a');
    if (!a) throw new Error('Container fehlt');
    const instance = api.mount(a);

    expect(api.scan()).toEqual([]);
    expect(api.mount(a)).toBe(instance);
    expect(a.querySelectorAll('.fw-booking-root')).toHaveLength(1);
  });

  it('übernimmt keine Container, die ein anderes Widget-Bundle bereits initialisiert hat', async () => {
    const win = await page(container(CAL_A, `${STATE_ATTRIBUTE}="ready"`));
    install(win);
    expect(roots(win)).toHaveLength(0);
  });

  it('initialisiert nachträglich eingefügte Container über scan()', async () => {
    const win = await page('<section id="tab"></section>');
    const api = install(win);
    const tab = win.document.getElementById('tab');
    if (!tab) throw new Error('Bereich fehlt');
    tab.innerHTML = container(CAL_A) + container(CAL_B);

    expect(api.scan(tab)).toHaveLength(2);
    expect(roots(win)).toHaveLength(2);
    expect(api.scan(tab)).toHaveLength(0);
  });

  it('scan() berücksichtigt auch das übergebene Element selbst', async () => {
    const win = await page(container(CAL_A, 'id="a"'));
    const api = install(win, { autoScan: false });
    const a = win.document.getElementById('a');
    if (!a) throw new Error('Container fehlt');
    expect(api.scan(a)).toHaveLength(1);
  });

  it('erlaubt nach unmount() eine neue Initialisierung', async () => {
    const win = await page(container(CAL_A, 'id="a"'));
    const api = install(win);
    const a = win.document.getElementById('a');
    if (!a) throw new Error('Container fehlt');
    expect(api.unmount(a)).toBe(true);
    expect(api.unmount(a)).toBe(false);
    expect(a.hasAttribute(STATE_ATTRIBUTE)).toBe(false);
    expect(api.scan()).toHaveLength(1);
  });

  it('zeigt bei ungültiger Einbindung einen Hinweis ohne die Attributwerte', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const win = await page(
      `<div id="x" data-fw-booking-calendar="&lt;img src=x onerror=alert(1)&gt;" data-fw-booking-api="${API}"></div>`,
    );
    install(win);
    const x = win.document.getElementById('x');
    if (!x) throw new Error('Container fehlt');

    expect(x.getAttribute(STATE_ATTRIBUTE)).toBe('error');
    expect(x.querySelector('img')).toBeNull();
    expect(x.textContent).toBe('Der Buchungskalender ist nicht richtig eingebunden.');
    expect(warn).toHaveBeenCalledWith(
      '[fw-booking] data-fw-booking-calendar fehlt oder ist ungültig',
    );
  });

  it('ersetzt vorhandene Platzhalter im Container', async () => {
    const win = await page(
      `<div data-fw-booking-calendar="${CAL_A}" data-fw-booking-api="${API}"><noscript>Bitte JavaScript aktivieren</noscript></div>`,
    );
    install(win);
    const [root] = roots(win);
    expect(root?.parentElement?.children).toHaveLength(1);
    expect(root?.querySelector('[role="status"]')?.textContent).toBe(
      'Buchungskalender wird geladen …',
    );
  });

  it('stellt window.FwBooking unveränderlich bereit', async () => {
    const win = await page('');
    const api = install(win);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(win)).not.toContain('FwBooking');
  });
});
