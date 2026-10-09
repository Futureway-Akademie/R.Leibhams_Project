// Eine Widget-Instanz je Container. Jede Instanz hat eigene Konfiguration, eigenen API-Client und
// eigenen DOM-Baum unter einem Root mit Präfix fw-booking-; Instanzen teilen keinen Zustand.
import { createApiClient } from './api/client.js';
import type { ApiClient } from './api/client.js';
import { readConfig } from './config.js';
import type { WidgetConfig } from './config.js';

/** Attribut, mit dem ein initialisierter Container gekennzeichnet wird (`ready` oder `error`). */
export const STATE_ATTRIBUTE = 'data-fw-booking-state';

export interface WidgetInstance {
  readonly container: HTMLElement;
  readonly root: HTMLElement;
  /** `null`, wenn die Datenattribute ungültig sind; die Instanz zeigt dann einen Hinweis. */
  readonly config: WidgetConfig | null;
  readonly api: ApiClient | null;
  destroy(): void;
}

export interface InstanceOptions {
  fetch?: typeof fetch;
}

export function createInstance(
  container: HTMLElement,
  options: InstanceOptions = {},
): WidgetInstance {
  const doc = container.ownerDocument;
  const result = readConfig(container);

  const root = doc.createElement('div');
  root.className = 'fw-booking-root';

  let config: WidgetConfig | null = null;
  let api: ApiClient | null = null;

  if (result.ok) {
    config = result.config;
    api = createApiClient({
      apiUrl: config.apiUrl,
      calendarId: config.calendarId,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    // Platzhalter, bis die Ansichten (task-4-2, task-4-3) ihn ersetzen.
    const status = doc.createElement('p');
    status.className = 'fw-booking-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Buchungskalender wird geladen …';
    root.append(status);
    container.setAttribute(STATE_ATTRIBUTE, 'ready');
  } else {
    root.classList.add('fw-booking-root--error');
    const message = doc.createElement('p');
    message.className = 'fw-booking-message fw-booking-message--error';
    message.textContent = 'Der Buchungskalender ist nicht richtig eingebunden.';
    root.append(message);
    container.setAttribute(STATE_ATTRIBUTE, 'error');
    // Hinweis für die einbindende Person; enthält nur den Attributnamen, keine Werte.
    console.warn(`[fw-booking] ${result.reason}`);
  }

  container.replaceChildren(root);

  return {
    container,
    root,
    config,
    api,
    destroy() {
      root.remove();
      container.removeAttribute(STATE_ATTRIBUTE);
    },
  };
}
