// Schlanker Client für die öffentliche Buchungs-API. Aus @fw-booking/shared werden nur Typen
// importiert, damit weder Zod noch der Temporal-Polyfill im Widget-Bundle landen. Die API prüft
// ihre Antworten selbst gegen die strikten Schemas.
import type {
  AvailableDatesResponse,
  BookingConfirmation,
  BookingErrorCode,
  BookingRequest,
  PublicServicesResponse,
  PublicSessionsResponse,
  PublicSlotsResponse,
} from '@fw-booking/shared';

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Abbruchgrund, an dem ein überschrittenes Zeitlimit erkannt wird. */
const TIMEOUT = Symbol('timeout');

/**
 * `network`: keine Antwort lesbar (offline, DNS, CORS – auch eine nicht freigegebene Website,
 * weil die 403-Antwort ohne CORS-Header für den Browser unlesbar ist).
 * `timeout`: Zeitlimit überschritten. `http`: Antwort mit Fehlerstatus.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http';

// Felder per `declare` und Zuweisung im Konstruktor: Klassenfelder würden beim Ziel ES2020
// zusätzliche Hilfsfunktionen ins Bundle bringen.
export class ApiError extends Error {
  declare readonly kind: ApiErrorKind;
  declare readonly status: number | null;
  /** Fachlicher Fehlercode, falls die API einen bekannten liefert. */
  declare readonly code: BookingErrorCode | null;
  /** Sekunden aus `Retry-After` bei 429. */
  declare readonly retryAfterSeconds: number | null;

  constructor(
    kind: ApiErrorKind,
    status: number | null,
    code: BookingErrorCode | null,
    retryAfterSeconds: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<BookingErrorCode>([
  'session_full',
  'slot_taken',
  'not_bookable',
  'already_booked',
  'idempotency_conflict',
  'change_deadline_passed',
  'not_cancellable',
  'link_expired',
  'rebook_not_allowed',
  'rate_limited',
  'too_many_bookings',
  'origin_not_allowed',
]);

export interface ApiClientOptions {
  apiUrl: string;
  calendarId: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ApiClient {
  getServices(signal?: AbortSignal): Promise<PublicServicesResponse>;
  getSlots(serviceId: string, date: string, signal?: AbortSignal): Promise<PublicSlotsResponse>;
  getAvailableDates(
    serviceId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<AvailableDatesResponse>;
  getSessions(
    serviceId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<PublicSessionsResponse>;
  createBooking(request: BookingRequest, signal?: AbortSignal): Promise<BookingConfirmation>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Erst beim Aufruf auflösen, damit später gesetzte oder ersetzte fetch-Funktionen greifen.
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = `${options.apiUrl}/api/public/calendars/${encodeURIComponent(options.calendarId)}`;

  async function request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    signal: AbortSignal | undefined,
  ): Promise<T> {
    // Eigener Controller statt AbortSignal.any/timeout, die ältere Safari-Versionen nicht kennen.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(TIMEOUT);
    }, timeoutMs);
    const forwardAbort = () => {
      controller.abort();
    };
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', forwardAbort);
    try {
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method: init.method,
          headers:
            init.body === undefined
              ? { Accept: 'application/json' }
              : { Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: controller.signal,
          // Keine Cookies der einbindenden Seite mitsenden, keinen Referrer preisgeben.
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        // Abbruch durch den Aufrufer wird unverändert weitergegeben.
        if (signal?.aborted) throw error;
        if (controller.signal.reason === TIMEOUT) {
          throw new ApiError('timeout', null, null, null, 'Zeitlimit überschritten');
        }
        throw new ApiError('network', null, null, null, 'Keine Verbindung zur Buchungs-API');
      }
      if (!response.ok) throw await toApiError(response);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  const service = (id: string) => `/services/${encodeURIComponent(id)}`;

  return {
    getServices: (signal) => request('/services', { method: 'GET' }, signal),
    getSlots: (serviceId, date, signal) =>
      request(`${service(serviceId)}/slots?${query({ date })}`, { method: 'GET' }, signal),
    getAvailableDates: (serviceId, from, to, signal) =>
      request(
        `${service(serviceId)}/available-dates?${query({ from, to })}`,
        { method: 'GET' },
        signal,
      ),
    getSessions: (serviceId, from, to, signal) =>
      request(`${service(serviceId)}/sessions?${query({ from, to })}`, { method: 'GET' }, signal),
    createBooking: (body, signal) => request('/bookings', { method: 'POST', body }, signal),
  };
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: BookingErrorCode | null = null;
  let message = `Anfrage fehlgeschlagen (${String(response.status)})`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      if ('code' in body && typeof body.code === 'string' && KNOWN_CODES.has(body.code)) {
        code = body.code as BookingErrorCode;
      }
      if ('message' in body && typeof body.message === 'string') message = body.message;
    }
  } catch {
    // Kein JSON: Status genügt.
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ApiError(
    'http',
    response.status,
    code,
    response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    message,
  );
}
