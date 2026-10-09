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
  /** Feldpfade ungültiger Eingaben bei 400 (z. B. `participant.email`), ohne Werte. */
  declare readonly fieldPaths: readonly string[];

  constructor(
    kind: ApiErrorKind,
    status: number | null,
    code: BookingErrorCode | null,
    retryAfterSeconds: number | null,
    message: string,
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
  /** Lese-Anfragen am HTTP-Cache des Browsers vorbei (`cache: 'reload'`). */
  bypassCache?: boolean;
}

/** Verfügbarkeit für die Auswahlansichten; erfüllt vom öffentlichen und vom Verwaltungs-Client. */
export interface AvailabilityReader {
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
}

export interface ApiClient extends AvailabilityReader {
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
  /**
   * Gleicher Client, dessen Lese-Anfragen den Browser-Cache umgehen; nach einem vergebenen Termin,
   * damit nicht die bis zu 30 s alte Verfügbarkeit erneut angezeigt wird.
   */
  fresh(): ApiClient;
}

export interface RequesterOptions {
  apiUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  bypassCache?: boolean;
  /** Zusätzliche Header jeder Anfrage (z. B. das Verwaltungs-Token). */
  headers?: Record<string, string>;
}

export type Requester = <T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  signal: AbortSignal | undefined,
) => Promise<T>;

/**
 * Gemeinsame Anfragelogik für öffentliche API und Verwaltungslink: Zeitlimit, Abbruch, keine
 * Cookies, kein Referrer, Fehler als ApiError. `path` beginnt unterhalb von `apiUrl`.
 */
export function createRequester(options: RequesterOptions): Requester {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Erst beim Aufruf auflösen, damit später gesetzte oder ersetzte fetch-Funktionen greifen.
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return async function request<T>(
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
        response = await doFetch(`${options.apiUrl}${path}`, {
          method: init.method,
          headers: {
            Accept: 'application/json',
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers,
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: controller.signal,
          // Keine Cookies der einbindenden Seite mitsenden, keinen Referrer preisgeben.
          credentials: 'omit',
          ...(options.bypassCache === true ? { cache: 'reload' as const } : {}),
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
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = `/api/public/calendars/${encodeURIComponent(options.calendarId)}`;
  const send = createRequester(options);
  const request = <T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    signal: AbortSignal | undefined,
  ) => send<T>(`${base}${path}`, init, signal);

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
    fresh: () => createApiClient({ ...options, bypassCache: true }),
  };
}

export function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: BookingErrorCode | null = null;
  let message = `Anfrage fehlgeschlagen (${String(response.status)})`;
  const fieldPaths: string[] = [];
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      if ('code' in body && typeof body.code === 'string' && KNOWN_CODES.has(body.code)) {
        code = body.code as BookingErrorCode;
      }
      if ('message' in body && typeof body.message === 'string') message = body.message;
      if ('issues' in body && Array.isArray(body.issues)) {
        for (const issue of body.issues as unknown[]) {
          if (typeof issue === 'object' && issue !== null && 'path' in issue) {
            if (typeof issue.path === 'string') fieldPaths.push(issue.path);
          }
        }
      }
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
    fieldPaths,
  );
}
