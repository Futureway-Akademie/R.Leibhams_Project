// Client für die Selbstverwaltung über den Verwaltungslink. Das Token geht ausschließlich im
// Header X-Booking-Token an die API, nie in URL oder Query.
import type {
  AvailableDatesResponse,
  PublicSessionsResponse,
  PublicSlotsResponse,
  SelfServiceBooking,
  SelfServiceRebookRequest,
} from '@fw-booking/shared';
import { createRequester, query } from './client.js';
import type { AvailabilityReader } from './client.js';

/** Header wie BOOKING_TOKEN_HEADER in @fw-booking/shared (dort im Zod-Modul). */
export const BOOKING_TOKEN_HEADER = 'X-Booking-Token';

const BASE = '/api/public/manage';

export interface ManageClientOptions {
  apiUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  bypassCache?: boolean;
}

export interface ManageClient {
  view(signal?: AbortSignal): Promise<SelfServiceBooking>;
  cancel(signal?: AbortSignal): Promise<SelfServiceBooking & { alreadyCancelled: boolean }>;
  rebook(
    target: SelfServiceRebookRequest,
    signal?: AbortSignal,
  ): Promise<SelfServiceBooking & { alreadyRebooked: boolean }>;
  /** Mögliche neue Termine; die Angebots-ID entfällt, das Token bestimmt das Angebot. */
  options(): AvailabilityReader;
  /** Gleicher Client am Browser-Cache vorbei (Antworten sind ohnehin no-store). */
  fresh(): ManageClient;
}

export function createManageClient(options: ManageClientOptions): ManageClient {
  const request = createRequester({
    ...options,
    headers: { [BOOKING_TOKEN_HEADER]: options.token },
  });
  const get = <T>(path: string, signal: AbortSignal | undefined) =>
    request<T>(`${BASE}${path}`, { method: 'GET' }, signal);

  return {
    view: (signal) => get('', signal),
    cancel: (signal) =>
      request(`${BASE}/cancel`, { method: 'POST', body: { confirm: true } }, signal),
    rebook: (target, signal) =>
      request(`${BASE}/rebook`, { method: 'POST', body: { ...target, confirm: true } }, signal),
    options: () => ({
      getSlots: (_serviceId, date, signal) =>
        get<PublicSlotsResponse>(`/slots?${query({ date })}`, signal),
      getAvailableDates: (_serviceId, from, to, signal) =>
        get<AvailableDatesResponse>(`/available-dates?${query({ from, to })}`, signal),
      getSessions: (_serviceId, from, to, signal) =>
        get<PublicSessionsResponse>(`/sessions?${query({ from, to })}`, signal),
    }),
    fresh: () => createManageClient({ ...options, bypassCache: true }),
  };
}
