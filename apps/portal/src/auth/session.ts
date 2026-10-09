// Sitzungszustand des Portals. Owner und CSRF-Token liegen nur im Query-Cache im Arbeitsspeicher
// (nicht in localStorage, sessionStorage oder lesbaren Cookies); das Sitzungs-Token selbst kennt
// JavaScript nie. Nach einem Neuladen holt das Portal beides über GET /api/auth/session.
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { LoginRequest } from '@fw-booking/shared';
import { createApiClient, isApiError } from '../api/client.js';
import type { ApiClient } from '../api/client.js';

export interface Session {
  owner: { id: string; email: string };
  csrfToken: string;
}

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/** Sitzung neu prüfen, wenn sie älter ist (z. B. beim Zurückkehren zum Tab). */
const SESSION_STALE_MS = 60_000;

export interface Portal {
  queryClient: QueryClient;
  api: ApiClient;
}

/**
 * Erzeugt Query-Client und API-Client. Jede Owner-Anfrage, die mit 401 endet, beendet die Sitzung
 * im Portal; die geschützten Seiten leiten daraufhin zum Login.
 */
export function createPortal(options: { fetch?: typeof fetch } = {}): Portal {
  const endSession = (): void => {
    endLocalSession(queryClient);
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isApiError(error, 401) && !isSessionQuery(query.queryKey)) endSession();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isApiError(error, 401)) endSession();
      },
    }),
    defaultOptions: {
      queries: {
        // Fehler der Anfrage selbst (4xx) nicht wiederholen, Netzwerk- und Serverfehler einmal.
        retry: (count, error) =>
          count < 1 && !(isApiError(error) && error.status !== null && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
  const api = createApiClient({
    getCsrfToken: () =>
      queryClient.getQueryData<Session | null>(SESSION_QUERY_KEY)?.csrfToken ?? null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { queryClient, api };
}

function isSessionQuery(key: readonly unknown[]): boolean {
  return key[0] === SESSION_QUERY_KEY[0] && key[1] === SESSION_QUERY_KEY[1];
}

/** Entfernt alle Owner-Daten aus dem Speicher und markiert die Sitzung als beendet. */
export function endLocalSession(queryClient: QueryClient): void {
  queryClient.setQueryData<Session | null>(SESSION_QUERY_KEY, null);
  queryClient.removeQueries({ predicate: (query) => !isSessionQuery(query.queryKey) });
}

/** Aktuelle Sitzung oder `null`, wenn keine besteht (401). */
export async function fetchSession(api: ApiClient, signal?: AbortSignal): Promise<Session | null> {
  try {
    return await api.get<Session>('/api/auth/session', { signal });
  } catch (error) {
    if (isApiError(error, 401)) return null;
    throw error;
  }
}

export const sessionQueryOptions = (api: ApiClient) => ({
  queryKey: SESSION_QUERY_KEY,
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchSession(api, signal),
  staleTime: SESSION_STALE_MS,
});

export async function login(
  api: ApiClient,
  queryClient: QueryClient,
  credentials: LoginRequest,
): Promise<Session> {
  const session = await api.post<Session>('/api/auth/login', credentials);
  // Neue Sitzung: Daten eines zuvor angemeldeten Owners nicht weiterverwenden.
  queryClient.removeQueries({ predicate: (query) => !isSessionQuery(query.queryKey) });
  queryClient.setQueryData<Session | null>(SESSION_QUERY_KEY, session);
  return session;
}

export async function logout(api: ApiClient, queryClient: QueryClient): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } catch (error) {
    if (isApiError(error, 403)) {
      // Veraltetes CSRF-Token (z. B. Anmeldung in einem anderen Tab): Sitzung neu lesen, einmal
      // wiederholen.
      const current = await fetchSession(api);
      queryClient.setQueryData<Session | null>(SESSION_QUERY_KEY, current);
      if (current) await api.post('/api/auth/logout');
    } else if (!isApiError(error, 401)) {
      throw error;
    }
  }
  endLocalSession(queryClient);
}
