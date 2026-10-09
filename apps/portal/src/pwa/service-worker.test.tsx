import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKIP_WAITING } from '../sw/rules.js';
import { UpdateNotice } from './UpdateNotice.js';
import {
  SERVICE_WORKER_URL,
  SKIP_WAITING_MESSAGE,
  UPDATE_CHECK_INTERVAL_MS,
  watchServiceWorker,
} from './service-worker.js';

/** Nachbildung eines ServiceWorker-Objekts mit Zustandswechseln. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  readonly postMessage = vi.fn();
  setState(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
  startUpdate(): FakeWorker {
    this.installing = new FakeWorker();
    this.dispatchEvent(new Event('updatefound'));
    return this.installing;
  }
}

class FakeContainer extends EventTarget {
  controller: object | null;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(() => Promise.resolve(this.registration));
  constructor(controlled: boolean) {
    super();
    this.controller = controlled ? {} : null;
  }
}

class FakeVisibility extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function setup(controlled = true) {
  const container = new FakeContainer(controlled);
  const visibility = new FakeVisibility();
  const reload = vi.fn();
  const updates = watchServiceWorker(container as unknown as ServiceWorkerContainer, {
    reload,
    visibility: visibility,
  });
  return { container, visibility, reload, updates };
}

/** Wartet, bis die Registrierung (Promise) verarbeitet ist. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchServiceWorker', () => {
  it('sendet dieselbe Nachricht, die der Service Worker erwartet', () => {
    expect(SKIP_WAITING_MESSAGE).toBe(SKIP_WAITING);
  });

  it('registriert /sw.js für das ganze Portal', async () => {
    const { container } = setup();
    await flush();
    expect(container.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: '/' });
  });

  it('meldet bei der Erstinstallation kein Update', async () => {
    const { container, updates } = setup(false);
    await flush();
    const worker = container.registration.startUpdate();
    worker.setState('installed');
    expect(updates.isUpdateAvailable()).toBe(false);
  });

  it('meldet eine neu installierte Version, solange eine alte das Portal steuert', async () => {
    const { container, updates } = setup();
    const listener = vi.fn();
    updates.subscribe(listener);
    await flush();
    const worker = container.registration.startUpdate();
    expect(updates.isUpdateAvailable()).toBe(false);
    worker.setState('installed');
    expect(updates.isUpdateAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('erkennt eine bereits wartende Version beim Start', async () => {
    const container = new FakeContainer(true);
    container.registration.waiting = new FakeWorker();
    const updates = watchServiceWorker(container as unknown as ServiceWorkerContainer, {
      reload: vi.fn(),
      visibility: new FakeVisibility(),
    });
    await flush();
    expect(updates.isUpdateAvailable()).toBe(true);
  });

  it('übernimmt die neue Version erst auf Anforderung und lädt dann neu', async () => {
    const { container, reload, updates } = setup();
    await flush();
    const worker = container.registration.startUpdate();
    worker.setState('installed');
    expect(worker.postMessage).not.toHaveBeenCalled();

    updates.applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: SKIP_WAITING });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lädt bei einem Wechsel ohne Anforderung nicht neu (Erstinstallation)', async () => {
    const { container, reload } = setup(false);
    await flush();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('fragt beim Zurückkehren in die App und stündlich nach einer neuen Version', async () => {
    const { container, visibility } = setup();
    await flush();
    visibility.visibilityState = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(container.registration.update).not.toHaveBeenCalled();
    visibility.visibilityState = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(container.registration.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(container.registration.update).toHaveBeenCalledTimes(2);
  });

  it('lässt das Portal ohne Fehler weiterlaufen, wenn die Registrierung scheitert', async () => {
    const container = new FakeContainer(false);
    container.register.mockImplementation(() => Promise.reject(new Error('unsicherer Kontext')));
    const updates = watchServiceWorker(container as unknown as ServiceWorkerContainer, {
      reload: vi.fn(),
      visibility: new FakeVisibility(),
    });
    await flush();
    expect(updates.isUpdateAvailable()).toBe(false);
  });
});

describe('UpdateNotice', () => {
  it('zeigt den Hinweis erst bei einer neuen Version und lädt per Knopf neu', async () => {
    const { container, reload, updates } = setup();
    render(<UpdateNotice updates={updates} />);
    await flush();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const worker = container.registration.startUpdate();
    act(() => {
      worker.setState('installed');
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Eine neue Version des Portals ist verfügbar.',
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Neu laden' }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: SKIP_WAITING });
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
