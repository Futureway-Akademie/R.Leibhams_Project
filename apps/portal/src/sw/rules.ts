// Regeln des Service Workers, ohne Abhängigkeit vom Worker-Kontext (testbar in Vitest).
// Grundsatz: Im Cache liegen ausschließlich die beim Build ermittelten statischen App-Dateien.
// Zur Laufzeit wird nichts nachträglich gespeichert; API-Anfragen laufen nie über den Cache.

export const CACHE_PREFIX = 'fw-portal-static-';

/** Ersatz für alle Seitenaufrufe innerhalb des Portals (Single-Page-App). */
export const APP_SHELL = '/index.html';

/** Nachricht des Portals, mit der eine wartende neue Version übernimmt. */
export const SKIP_WAITING = 'fw-portal:skip-waiting';

/** Vom Build eingesetzte Liste der statischen Dateien samt Version (Hash über deren Inhalt). */
export interface Precache {
  version: string;
  urls: string[];
}

/** Die für die Entscheidung nötigen Teile einer Anfrage. */
export interface RequestInfo {
  method: string;
  url: string;
  mode: string;
}

export function cacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** Caches früherer Portal-Versionen; fremde Caches derselben Origin bleiben unberührt. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Liefert den Cache-Schlüssel, unter dem die Antwort liegt, oder `null`, wenn der Service Worker
 * die Anfrage nicht beantwortet (dann gilt das normale Verhalten des Browsers, also das Netz).
 */
export function cacheKeyFor(
  request: RequestInfo,
  origin: string,
  precached: ReadonlySet<string>,
): string | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== origin || isApiPath(url.pathname)) return null;

  if (request.mode === 'navigate') {
    if (url.search === '' && precached.has(url.pathname)) return url.pathname;
    // Pfade mit Dateiendung (z. B. /robots.txt) sind keine Seiten des Portals.
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return null;
    return precached.has(APP_SHELL) ? APP_SHELL : null;
  }

  if (url.search !== '') return null;
  return precached.has(url.pathname) ? url.pathname : null;
}

export function isSkipWaitingMessage(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && (data as { type?: unknown }).type === SKIP_WAITING
  );
}
