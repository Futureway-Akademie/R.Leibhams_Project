import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { PortalUpdates } from './service-worker.js';

/** Hinweis auf eine neue Portal-Version; die Statusregion besteht immer, der Inhalt nur bei Bedarf. */
export function UpdateNotice({ updates }: { updates: PortalUpdates }): ReactNode {
  const available = useSyncExternalStore(updates.subscribe, updates.isUpdateAvailable);
  return (
    <div role="status" className={available ? 'update-notice' : undefined}>
      {available && (
        <>
          <p>Eine neue Version des Portals ist verfügbar.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              updates.applyUpdate();
            }}
          >
            Neu laden
          </button>
        </>
      )}
    </div>
  );
}
