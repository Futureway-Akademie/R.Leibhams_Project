import type { BookingRequest } from '@fw-booking/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';

const CALENDAR_ID = 'cal_AbCdEfGhIjKlMnOp';
const SERVICE_ID = '66f1a2b3c4d5e6f708192a3b';
const BASE = `https://api.example.de/api/public/calendars/${CALENDAR_ID}`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function setup(response: () => Promise<Response> | Response, timeoutMs?: number) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const client = createApiClient({
    apiUrl: 'https://api.example.de',
    calendarId: CALENDAR_ID,
    fetch: fetchMock,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { client, fetchMock };
}

function lastCall(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch wurde nicht aufgerufen');
  const [url, init] = call;
  return { url: url as string, init: init ?? {} };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Promise wurde nicht abgelehnt');
}

describe('createApiClient', () => {
  it('ruft die öffentlichen Endpunkte des Kalenders auf', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));

    await client.getServices();
    expect(lastCall(fetchMock).url).toBe(`${BASE}/services`);

    await client.getSlots(SERVICE_ID, '2026-10-12');
    expect(lastCall(fetchMock).url).toBe(`${BASE}/services/${SERVICE_ID}/slots?date=2026-10-12`);

    await client.getAvailableDates(SERVICE_ID, '2026-10-01', '2026-10-31');
    expect(lastCall(fetchMock).url).toBe(
      `${BASE}/services/${SERVICE_ID}/available-dates?from=2026-10-01&to=2026-10-31`,
    );

    await client.getSessions(SERVICE_ID, '2026-10-01', '2026-10-31');
    expect(lastCall(fetchMock).url).toBe(
      `${BASE}/services/${SERVICE_ID}/sessions?from=2026-10-01&to=2026-10-31`,
    );
  });

  it('kodiert Pfadbestandteile', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));
    await client.getSlots('a/b?c', '2026-10-12');
    expect(lastCall(fetchMock).url).toBe(`${BASE}/services/a%2Fb%3Fc/slots?date=2026-10-12`);
  });

  it('sendet ohne Cookies und ohne Referrer', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));
    await client.getServices();
    const { init } = lastCall(fetchMock);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.body).toBeUndefined();
  });

  it('sendet Buchungen als JSON und liefert die Bestätigung', async () => {
    const confirmation = { bookingId: SERVICE_ID, status: 'confirmed' };
    const { client, fetchMock } = setup(() => json(201, confirmation));
    const request: BookingRequest = {
      type: 'group',
      sessionId: SERVICE_ID,
      participant: { name: 'Erika Mustermann', email: 'erika@example.de', phone: '' },
      idempotencyKey: '0b6f6c2e-8f1a-4d3b-9c8e-2a7d5e4f3b1c',
      privacyAccepted: true,
    };

    await expect(client.createBooking(request)).resolves.toEqual(confirmation);
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/bookings`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('übernimmt bekannte fachliche Fehlercodes', async () => {
    const { client } = setup(() =>
      json(409, { statusCode: 409, message: 'Kurstermin ist ausgebucht', code: 'session_full' }),
    );
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({
      kind: 'http',
      status: 409,
      code: 'session_full',
      retryAfterSeconds: null,
      message: 'Kurstermin ist ausgebucht',
    });
  });

  it('ignoriert unbekannte Fehlercodes', async () => {
    const { client } = setup(() => json(404, { statusCode: 404, message: 'x', code: 'geheim' }));
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({ kind: 'http', status: 404, code: null });
  });

  it('liest Retry-After bei 429', async () => {
    const { client } = setup(() =>
      json(
        429,
        { statusCode: 429, message: 'Zu viele', code: 'rate_limited' },
        {
          'Retry-After': '42',
        },
      ),
    );
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 42 });
  });

  it('verträgt Fehlerantworten ohne JSON', async () => {
    const { client } = setup(() => new Response('Bad Gateway', { status: 502 }));
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({
      kind: 'http',
      status: 502,
      code: null,
      message: 'Anfrage fehlgeschlagen (502)',
    });
  });

  it('meldet Netzwerkfehler ohne Details', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({ kind: 'network', status: null, code: null });
  });

  it('bricht nach dem Zeitlimit ab', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = createApiClient({
      apiUrl: 'https://api.example.de',
      calendarId: CALENDAR_ID,
      fetch: fetchMock,
      timeoutMs: 10,
    });
    const error = await rejection(client.getServices());
    expect(error).toMatchObject({ kind: 'timeout', status: null });
  });

  it('gibt einen Abbruch durch den Aufrufer unverändert weiter', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = createApiClient({
      apiUrl: 'https://api.example.de',
      calendarId: CALENDAR_ID,
      fetch: fetchMock,
    });
    const controller = new AbortController();
    const pending = client.getServices(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
