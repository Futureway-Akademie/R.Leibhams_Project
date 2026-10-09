// Client für die Owner-API unter derselben Origin. Das Sitzungs-Token liegt ausschließlich im
// HttpOnly-Cookie; JavaScript sieht nur das CSRF-Token, das der Aufrufer im Arbeitsspeicher hält.

export const DEFAULT_TIMEOUT_MS = 15_000;
export const CSRF_HEADER = 'X-CSRF-Token';

/** Abbruchgrund, an dem ein überschrittenes Zeitlimit erkannt wird. */
const TIMEOUT = Symbol('timeout');

/**
 * `network`: keine Antwort (offline, Server nicht erreichbar). `timeout`: Zeitlimit überschritten.
 * `http`: Antwort mit Fehlerstatus.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Fachlicher Fehlercode aus der Antwort (`code`), falls vorhanden. */
  readonly code: string | null;
  /** Sekunden aus `Retry-After` bei 429. */
  readonly retryAfterSeconds: number | null;
  /** Feldpfade ungültiger Eingaben bei 400 (z. B. `bookingRules.horizonDays`), ohne Werte. */
  readonly fieldPaths: readonly string[];

  constructor(
    kind: ApiErrorKind,
    status: number | null,
    message: string,
    code: string | null = null,
    retryAfterSeconds: number | null = null,
    fieldPaths: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fieldPaths = fieldPaths;
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

export interface ApiClientOptions {
  /** Liefert das aktuelle CSRF-Token für ändernde Anfragen (oder `null` ohne Sitzung). */
  getCsrfToken: () => string | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    method: Method,
    path: string,
    body: unknown,
    { signal }: RequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith('/api/')) throw new Error(`Ungültiger API-Pfad: ${path}`);

    const headers: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = {
      method,
      headers,
      // Nur die eigene Origin; das Sitzungs-Cookie wird nie an fremde Server geschickt.
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    };
    if (method !== 'GET') {
      // Die API verlangt für ändernde Anfragen JSON und das CSRF-Token der Sitzung.
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
      const csrf = options.getCsrfToken();
      if (csrf) headers[CSRF_HEADER] = csrf;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(TIMEOUT);
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort', onAbort, { once: true });
    init.signal = controller.signal;

    let response: Response;
    try {
      response = await doFetch(path, init);
    } catch (error) {
      if (controller.signal.reason === TIMEOUT) {
        throw new ApiError('timeout', null, 'Zeitüberschreitung der Anfrage');
      }
      if (signal?.aborted) throw error;
      throw new ApiError('network', null, 'Server nicht erreichbar');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    delete: (path, body, opts) => request('DELETE', path, body, opts),
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  let message = `HTTP ${String(response.status)}`;
  let code: string | null = null;
  let fieldPaths: string[] = [];
  try {
    const data = (await response.json()) as { message?: unknown; code?: unknown; issues?: unknown };
    if (typeof data.message === 'string') message = data.message;
    if (typeof data.code === 'string') code = data.code;
    if (Array.isArray(data.issues)) {
      fieldPaths = data.issues
        .map((issue: unknown) =>
          typeof issue === 'object' && issue !== null && 'path' in issue ? issue.path : null,
        )
        .filter((path): path is string => typeof path === 'string');
    }
  } catch {
    // Antwort ohne JSON-Body: Status genügt.
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ApiError(
    'http',
    response.status,
    message,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    fieldPaths,
  );
}
