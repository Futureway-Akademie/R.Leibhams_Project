// Gemeinsame Hilfen für Widget-Tests in jsdom (nicht Teil des Bundles).
import type { PublicService, PublicSession, PublicSlot } from '@fw-booking/shared';
import { JSDOM } from 'jsdom';
import { SELECT_EVENT } from './app.js';
import type { Selection } from './app.js';
import { install } from './bootstrap.js';

export const CAL = 'cal_AAAAAAAAAAAAAAAA';
export const API = 'https://api.example.de';
export const BASE = `${API}/api/public/calendars/${CAL}`;
export const TZ = 'Europe/Berlin';
export const YOGA = '66f1a2b3c4d5e6f708192a01';
export const PILATES = '66f1a2b3c4d5e6f708192a02';
export const HAIRCUT = '66f1a2b3c4d5e6f708192a03';
/** 2026-10-11 22:30 UTC ist in Berlin bereits der 12.10. */
export const NOW = new Date('2026-10-11T22:30:00Z');

type TestWindow = Window & typeof globalThis;
export type Handler = (url: URL, init: RequestInit | undefined) => Promise<Response> | Response;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export function service(
  id: string,
  title: string,
  type: 'single' | 'group' = 'group',
): PublicService {
  return { id, title, type, description: null, durationMinutes: 60 };
}

export function session(
  id: string,
  startsAt: string,
  freeSeats: number,
  location: string | null = null,
) {
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60_000).toISOString().replace('.000', '');
  return { id, serviceId: YOGA, startsAt, endsAt, freeSeats, location } satisfies PublicSession;
}

export function sessionsResponse(sessions: PublicSession[], serviceId = YOGA) {
  return json({ serviceId, timeZone: TZ, sessions });
}

/** Fetch-Attrappe, die Anfragen nach Pfad beantwortet und alle Aufrufe festhält. */
export function router(routes: Record<string, Handler | Handler[]>) {
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

export async function mount(routes: Record<string, Handler | Handler[]>, attrs = '') {
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

export const twoCourses = {
  '/services': () =>
    json({ timeZone: TZ, services: [service(YOGA, 'Yoga'), service(PILATES, 'Pilates')] }),
};

export function click(node: HTMLElement | null) {
  if (!node) throw new Error('Element fehlt');
  node.click();
}

export function slot(startsAt: string, minutes = 30): PublicSlot {
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000)
    .toISOString()
    .replace('.000', '');
  return { startsAt, endsAt };
}

export function slotsResponse(slots: PublicSlot[], serviceId = HAIRCUT) {
  return json({ serviceId, timeZone: TZ, slots });
}

export function datesResponse(dates: string[], serviceId = HAIRCUT) {
  return json({ serviceId, timeZone: TZ, dates });
}
