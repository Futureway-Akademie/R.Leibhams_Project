// Hilfen für Portal-Tests: Routen im Speicher-Router mit gefälschter API.
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { PortalProvider } from './auth/hooks.js';
import { createPortal } from './auth/session.js';
import type { Portal, Session } from './auth/session.js';
import { routes } from './routes.js';

export const SESSION: Session = {
  owner: { id: '66f1a2b3c4d5e6f708192a01', email: 'owner@example.test' },
  csrfToken: 'csrf-token-aus-der-sitzung',
};

/**
 * Anfragen, die das Layout auf jeder Seite stellt (Zahl fehlgeschlagener Benachrichtigungen);
 * einzelne Tests können sie überschreiben.
 */
const DEFAULT_HANDLERS: Record<string, Handler> = {
  'GET /api/owner/notifications/failed': () =>
    json({ notifications: [], total: 0, retryingCount: 0 }),
};

export interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
  init: RequestInit;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Gefälschtes fetch: Antworten je `METHODE /pfad`, Liste aller Aufrufe. */
export function fakeFetch(handlers: Record<string, Handler | Handler[]>): {
  fetch: Mock<typeof globalThis.fetch>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queues = new Map(
    Object.entries({ ...DEFAULT_HANDLERS, ...handlers }).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
  const fetchMock = vi.fn<typeof globalThis.fetch>((input, init = {}) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      init,
    };
    calls.push(call);
    const entry = queues.get(`${method} ${path}`);
    const handler = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (!handler) return Promise.reject(new Error(`Unerwartete Anfrage ${method} ${path}`));
    return Promise.resolve(handler(call));
  });
  return { fetch: fetchMock, calls };
}

export const withSession: Handler = () => json(SESSION);
export const noSession: Handler = () => json({ statusCode: 401, message: 'Unauthorized' }, 401);

export function renderPortal(
  path: string,
  fetchImpl: typeof fetch,
): RenderResult & { portal: Portal; router: ReturnType<typeof createMemoryRouter> } {
  const portal = createPortal({ fetch: fetchImpl });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <PortalProvider portal={portal}>
      <RouterProvider router={router} />
    </PortalProvider>,
  );
  return { ...result, portal, router };
}
