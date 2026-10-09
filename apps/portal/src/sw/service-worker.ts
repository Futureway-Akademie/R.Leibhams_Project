// Service Worker des Portals, ausgeliefert als /sw.js (siehe build/service-worker-plugin.ts).
// Er hält nur die statischen App-Dateien vor; Daten kommen immer frisch aus der Owner-API.
import { cacheKeyFor, cacheName, isSkipWaitingMessage, staleCaches } from './rules.js';
import type { Precache } from './rules.js';

declare const self: ServiceWorkerGlobalScope;
/** Wird beim Build durch die Liste der statischen Dateien ersetzt. */
declare const __FW_PRECACHE__: Precache;

const { version, urls } = __FW_PRECACHE__;
const CACHE = cacheName(version);
const PRECACHED = new Set(urls);

self.addEventListener('install', (event) => {
  // Am HTTP-Cache vorbei laden, damit keine veraltete index.html in die neue Version gerät.
  // Die neue Version wartet, bis das Portal sie per Knopf übernimmt (kein skipWaiting hier).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(staleCaches(names, CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (isSkipWaitingMessage(event.data)) void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const key = cacheKeyFor(event.request, self.location.origin, PRECACHED);
  if (key === null) return;
  event.respondWith(fromCache(key, event.request));
});

/** Antwort aus dem eigenen Cache, sonst aus dem Netz; gespeichert wird hier nie etwas. */
async function fromCache(key: string, request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  return cached ?? fetch(request);
}
