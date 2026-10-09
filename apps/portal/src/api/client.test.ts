import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CSRF_HEADER, createApiClient } from './client.js';
import { fakeFetch, json } from '../test-utils.js';

describe('createApiClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('liest mit Cookie nur der eigenen Origin und ohne CSRF-Token', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/auth/session': () => json({ ok: true }) });
    const api = createApiClient({ getCsrfToken: () => 'csrf', fetch });

    await expect(api.get('/api/auth/session')).resolves.toEqual({ ok: true });
    const [call] = calls;
    expect(call?.init.credentials).toBe('same-origin');
    expect(call?.init.cache).toBe('no-store');
    expect(call?.init.referrerPolicy).toBe('no-referrer');
    expect(call?.headers.has(CSRF_HEADER)).toBe(false);
    expect(call?.init.body).toBeUndefined();
  });

  it('sendet ändernde Anfragen als JSON mit dem aktuellen CSRF-Token', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/owner/x': () => json({ id: 1 }, 201),
      'PATCH /api/owner/x': () => new Response(null, { status: 204 }),
    });
    let token = 'erstes';
    const api = createApiClient({ getCsrfToken: () => token, fetch });

    await expect(api.post('/api/owner/x', { a: 1 })).resolves.toEqual({ id: 1 });
    token = 'zweites';
    await expect(api.patch('/api/owner/x')).resolves.toBeUndefined();

    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.headers.get(CSRF_HEADER)).toBe('erstes');
    expect(calls[0]?.body).toEqual({ a: 1 });
    // Ohne Body sendet der Client `{}`, weil die API für ändernde Anfragen JSON verlangt.
    expect(calls[1]?.body).toEqual({});
    expect(calls[1]?.headers.get(CSRF_HEADER)).toBe('zweites');
  });

  it('lässt den CSRF-Header ohne Sitzung weg', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/auth/login': () => json({}) });
    const api = createApiClient({ getCsrfToken: () => null, fetch });
    await api.post('/api/auth/login', {});
    expect(calls[0]?.headers.has(CSRF_HEADER)).toBe(false);
  });

  it('wandelt Fehlerantworten in ApiError mit Status, Meldung, Code und Retry-After', async () => {
    const { fetch } = fakeFetch({
      'GET /api/a': () => json({ statusCode: 401, message: 'Unauthorized' }, 401),
      'GET /api/b': () =>
        json({ code: 'rate_limited', message: 'Zu viele' }, 429, { 'Retry-After': '30' }),
      'GET /api/c': () => new Response('kaputt', { status: 502 }),
    });
    const api = createApiClient({ getCsrfToken: () => null, fetch });

    await expect(api.get('/api/a')).rejects.toMatchObject({
      kind: 'http',
      status: 401,
      message: 'Unauthorized',
      code: null,
    });
    await expect(api.get('/api/b')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 30,
    });
    const error = await api.get('/api/c').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: 'HTTP 502', retryAfterSeconds: null });
  });

  it('übernimmt Feldpfade ungültiger Eingaben aus 400-Antworten', async () => {
    const { fetch } = fakeFetch({
      'POST /api/owner/x': () =>
        json(
          {
            message: 'Ungültige Eingabe',
            issues: [{ path: 'title', message: 'x' }, { path: 'bookingRules.horizonDays' }, {}],
          },
          400,
        ),
    });
    const api = createApiClient({ getCsrfToken: () => 'csrf', fetch });
    await expect(api.post('/api/owner/x', {})).rejects.toMatchObject({
      status: 400,
      fieldPaths: ['title', 'bookingRules.horizonDays'],
    });
  });

  it('meldet Netzwerkfehler und Zeitüberschreitung', async () => {
    const api = createApiClient({
      getCsrfToken: () => null,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(api.get('/api/x')).rejects.toMatchObject({ kind: 'network', status: null });

    vi.useFakeTimers();
    const slow = createApiClient({
      getCsrfToken: () => null,
      timeoutMs: 1000,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    });
    const pending = slow.get('/api/x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ kind: 'timeout' });
  });

  it('reicht einen Abbruch durch den Aufrufer unverändert weiter', async () => {
    const api = createApiClient({
      getCsrfToken: () => null,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    });
    const controller = new AbortController();
    const pending = api.get('/api/x', { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('akzeptiert nur Pfade der eigenen API', async () => {
    const { fetch } = fakeFetch({});
    const api = createApiClient({ getCsrfToken: () => null, fetch });
    await expect(api.get('https://fremd.example/api/x')).rejects.toThrow('Ungültiger API-Pfad');
    await expect(api.get('//fremd.example/api/x')).rejects.toThrow('Ungültiger API-Pfad');
    expect(fetch).not.toHaveBeenCalled();
  });
});
