// Registrierung des Service Workers und Erkennung einer wartenden neuen Portal-Version.
// Die neue Version übernimmt erst, wenn der Owner „Neu laden“ wählt (keine verlorenen Eingaben).

export const SERVICE_WORKER_URL = '/sw.js';

/**
 * Spiegel von `SKIP_WAITING` aus `src/sw/rules.ts` (per Test abgeglichen). Ein Import würde
 * rules.ts in einen gemeinsamen Chunk verschieben, den der Service Worker nicht laden kann.
 */
export const SKIP_WAITING_MESSAGE = 'fw-portal:skip-waiting';

/** Abstand, in dem eine lange geöffnete App nach einer neuen Version fragt. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PortalUpdates {
  subscribe: (listener: () => void) => () => void;
  isUpdateAvailable: () => boolean;
  /** Lässt die wartende Version übernehmen; die Seite lädt danach neu. */
  applyUpdate: () => void;
}

export interface WatchOptions {
  reload: () => void;
  /** Für Tests: Ereignisquelle für Sichtbarkeitswechsel (Standard: document). */
  visibility?: Pick<Document, 'addEventListener' | 'visibilityState'>;
}

export function watchServiceWorker(
  container: ServiceWorkerContainer,
  { reload, visibility = document }: WatchOptions,
): PortalUpdates {
  const listeners = new Set<() => void>();
  let waiting: ServiceWorker | null = null;
  let updateRequested = false;

  const setWaiting = (worker: ServiceWorker): void => {
    waiting = worker;
    for (const listener of listeners) listener();
  };

  // Ein Wechsel des steuernden Workers kommt auch bei der Erstinstallation (clients.claim);
  // neu geladen wird nur, wenn der Owner die neue Version angefordert hat.
  container.addEventListener('controllerchange', () => {
    if (updateRequested) reload();
  });

  container
    .register(SERVICE_WORKER_URL, { scope: '/' })
    .then((registration) => {
      // Ohne steuernden Worker ist es die Erstinstallation, kein Update.
      if (registration.waiting && container.controller) setWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && container.controller) setWaiting(installing);
        });
      });

      const checkForUpdate = (): void => {
        registration.update().catch(() => undefined);
      };
      visibility.addEventListener('visibilitychange', () => {
        if (visibility.visibilityState === 'visible') checkForUpdate();
      });
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    })
    // Ohne Service Worker funktioniert das Portal unverändert, nur nicht installierbar/offline.
    .catch(() => undefined);

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isUpdateAvailable: () => waiting !== null,
    applyUpdate: () => {
      if (!waiting) return;
      updateRequested = true;
      waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
    },
  };
}

/** Nur im Produktions-Build und in Browsern mit Service-Worker-Unterstützung. */
export function startServiceWorker(): PortalUpdates | null {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return null;
  return watchServiceWorker(navigator.serviceWorker, {
    reload: () => {
      window.location.reload();
    },
  });
}
