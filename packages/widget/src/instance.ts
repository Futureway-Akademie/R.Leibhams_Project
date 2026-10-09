// Eine Widget-Instanz je Container. Jede Instanz hat eigene Konfiguration, eigenen API-Client und
// eigenen DOM-Baum unter einem Root mit Präfix fw-booking-; Instanzen teilen keinen Zustand.
import { createApiClient } from './api/client.js';
import type { ApiClient } from './api/client.js';
import { startApp } from './app.js';
import type { App, Selection } from './app.js';
import { readConfig } from './config.js';
import { startManageApp } from './manage/manage-app.js';
import type { ManageToken } from './manage/token.js';
import type { WidgetConfig } from './config.js';
import { el } from './dom.js';
import { messages } from './messages.js';

/** Attribut, mit dem ein initialisierter Container gekennzeichnet wird (`ready` oder `error`). */
export const STATE_ATTRIBUTE = 'data-fw-booking-state';

export interface WidgetInstance {
  readonly container: HTMLElement;
  readonly root: HTMLElement;
  /** `null`, wenn die Datenattribute ungültig sind; die Instanz zeigt dann einen Hinweis. */
  readonly config: WidgetConfig | null;
  readonly api: ApiClient | null;
  /** Aktuell gewählter Termin oder `null`. */
  readonly selection: Selection | null;
  destroy(): void;
}

export interface InstanceOptions {
  fetch?: typeof fetch;
  /** Aktuelle Zeit (für Tests); Standard: Systemzeit. */
  now?: () => Date;
  /** Verwaltungslink dieser Seite: Container zeigt die Selbstverwaltung statt der Buchung. */
  manage?: ManageToken;
}

export function createInstance(
  container: HTMLElement,
  options: InstanceOptions = {},
): WidgetInstance {
  const doc = container.ownerDocument;
  const result = readConfig(container);
  const root = el(doc, 'div', { className: 'root' });
  container.replaceChildren(root);

  let config: WidgetConfig | null = null;
  let api: ApiClient | null = null;
  let app: App | null = null;

  if (result.ok) {
    config = result.config;
    api = createApiClient({
      apiUrl: config.apiUrl,
      calendarId: config.calendarId,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    container.setAttribute(STATE_ATTRIBUTE, 'ready');
    const now = options.now ?? (() => new Date());
    const booking = (cfg: WidgetConfig, client: ApiClient) =>
      startApp({ container, root, config: cfg, api: client, now });
    const manage = options.manage ?? null;
    if (manage === null) {
      app = booking(config, api);
    } else {
      const cfg = config;
      const client = api;
      app = startManageApp({
        container,
        root,
        config: cfg,
        token: manage.kind === 'token' ? manage.token : null,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        now,
        onBookNew: () => {
          // Nach Storno: derselbe Container wechselt zur normalen Buchung.
          app?.destroy();
          app = booking(cfg, client);
        },
      });
    }
  } else {
    root.classList.add('fw-booking-root--error');
    root.append(
      el(doc, 'p', { className: ['message', 'message--error'], text: messages.misconfigured }),
    );
    container.setAttribute(STATE_ATTRIBUTE, 'error');
    // Hinweis für die einbindende Person; enthält nur den Attributnamen, keine Werte.
    console.warn(`[fw-booking] ${result.reason}`);
  }

  return {
    container,
    root,
    config,
    api,
    get selection() {
      return app?.selection ?? null;
    },
    destroy() {
      app?.destroy();
      root.remove();
      container.removeAttribute(STATE_ATTRIBUTE);
    },
  };
}
