// Globaler Einstieg des Widgets. Das Script darf mehrfach auf einer Seite stehen (z. B. durch
// mehrere Shortcodes oder Plugins); nur die erste Ausführung installiert `window.FwBooking`,
// jede weitere verwendet sie. Jeder Container wird höchstens einmal initialisiert.
import { CONTAINER_SELECTOR } from './config.js';
import { STATE_ATTRIBUTE, createInstance } from './instance.js';
import { takeManageToken } from './manage/token.js';
import type { ManageToken } from './manage/token.js';
import type { InstanceOptions, WidgetInstance } from './instance.js';

export const WIDGET_VERSION = '0.1.0';

/** Markiert den Container, der auf der Verwaltungsseite die Selbstverwaltung zeigt. */
export const MANAGE_ATTRIBUTE = 'data-fw-booking-manage';

export interface FwBookingApi {
  readonly version: string;
  /** Initialisiert alle noch nicht initialisierten Container unterhalb von `root`. */
  scan(root?: ParentNode): WidgetInstance[];
  /** Initialisiert einen einzelnen Container; liefert die bestehende Instanz, falls vorhanden. */
  mount(container: HTMLElement): WidgetInstance;
  /** Entfernt die Instanz eines Containers, z. B. bevor ein Page-Builder ihn neu aufbaut. */
  unmount(container: HTMLElement): boolean;
}

declare global {
  interface Window {
    FwBooking?: FwBookingApi;
  }
}

export interface InstallOptions extends InstanceOptions {
  /** Container beim Laden automatisch suchen (Standard: ja). */
  autoScan?: boolean;
}

export function install(
  win: Window & typeof globalThis,
  options: InstallOptions = {},
): FwBookingApi {
  const existing = win.FwBooking;
  if (existing) return existing;

  const doc = win.document;
  // Verwaltungslink sofort beim Ausführen des Scripts lesen und aus der Adresse entfernen,
  // noch bevor die Seite fertig geladen ist.
  let manage: ManageToken = takeManageToken(win);
  const instances = new WeakMap<HTMLElement, WidgetInstance>();
  const instanceOptions: InstanceOptions = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  };

  /**
   * Container für die Selbstverwaltung: der erste mit data-fw-booking-manage, sonst der erste
   * Container der Seite. Das Token wird genau einmal vergeben.
   */
  function claimManage(container: HTMLElement): ManageToken {
    if (manage === null) return null;
    const marked = doc.querySelector(`${CONTAINER_SELECTOR}[${MANAGE_ATTRIBUTE}]`);
    const target = marked ?? doc.querySelector(CONTAINER_SELECTOR);
    if (target !== container) return null;
    const claimed = manage;
    manage = null;
    return claimed;
  }

  function mount(container: HTMLElement): WidgetInstance {
    const current = instances.get(container);
    if (current) return current;
    const claimed = claimManage(container);
    const instance = createInstance(
      container,
      claimed === null ? instanceOptions : { ...instanceOptions, manage: claimed },
    );
    instances.set(container, instance);
    return instance;
  }

  function scan(root: ParentNode = doc): WidgetInstance[] {
    const found: HTMLElement[] = [];
    if (root instanceof win.HTMLElement && root.matches(CONTAINER_SELECTOR)) found.push(root);
    found.push(...root.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR));
    // Container, die bereits ein anderes Widget-Bundle übernommen hat, bleiben unberührt.
    return found.filter((el) => !instances.has(el) && !el.hasAttribute(STATE_ATTRIBUTE)).map(mount);
  }

  function unmount(container: HTMLElement): boolean {
    const instance = instances.get(container);
    if (!instance) return false;
    instance.destroy();
    instances.delete(container);
    return true;
  }

  const api: FwBookingApi = Object.freeze({ version: WIDGET_VERSION, scan, mount, unmount });
  Object.defineProperty(win, 'FwBooking', { value: api, configurable: true, enumerable: false });

  if (options.autoScan !== false) {
    if (doc.readyState === 'loading') {
      doc.addEventListener(
        'DOMContentLoaded',
        () => {
          scan();
        },
        { once: true },
      );
    } else {
      scan();
    }
  }
  return api;
}
