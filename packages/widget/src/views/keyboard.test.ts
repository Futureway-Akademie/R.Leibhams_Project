import { describe, expect, it, vi } from 'vitest';
import {
  HAIRCUT,
  TZ,
  click,
  datesResponse,
  json,
  mount,
  service,
  slot,
  slotsResponse,
} from '../test-utils.js';

// NOW (test-utils) entspricht Montag, 12.10.2026 in Berlin.
type Widget = Awaited<ReturnType<typeof mount>>;

const routes = {
  '/services': () => json({ timeZone: TZ, services: [service(HAIRCUT, 'Haarschnitt', 'single')] }),
  [`/services/${HAIRCUT}/available-dates`]: (url: URL) =>
    datesResponse(
      url.searchParams.get('from')?.startsWith('2026-10') === true
        ? ['2026-10-14', '2026-10-28']
        : ['2026-11-04'],
    ),
  [`/services/${HAIRCUT}/slots`]: (url: URL) =>
    slotsResponse([slot(`${url.searchParams.get('date') ?? ''}T07:00:00Z`)]),
};

async function open(): Promise<Widget> {
  const w = await mount(routes);
  await vi.waitFor(() => {
    expect(w.$$('.fw-booking-slot')).toHaveLength(1);
  });
  return w;
}

function day(w: Widget, date: string): HTMLButtonElement {
  const node = w.$(`.fw-booking-day[data-date="${date}"]`);
  if (!(node instanceof w.win.HTMLButtonElement)) throw new Error(`Tag ${date} fehlt`);
  return node;
}

function tabStops(w: Widget): string[] {
  return w
    .$$('.fw-booking-day')
    .filter((n) => n.tabIndex === 0)
    .map((n) => n.dataset['date'] ?? '');
}

function press(w: Widget, key: string) {
  const target = w.win.document.activeElement;
  if (!target) throw new Error('Kein Fokus');
  target.dispatchEvent(
    new w.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

function focused(w: Widget): string | undefined {
  return (w.win.document.activeElement as HTMLElement | null)?.dataset['date'];
}

describe('Monatskalender per Tastatur', () => {
  it('hat genau einen Tab-Stopp: den gewählten Tag', async () => {
    const w = await open();
    expect(tabStops(w)).toEqual(['2026-10-14']);
    // Nicht verfügbare Tage sind fokussierbar, aber als nicht verfügbar gekennzeichnet.
    expect(day(w, '2026-10-15').disabled).toBe(false);
    expect(day(w, '2026-10-15').getAttribute('aria-disabled')).toBe('true');
    expect(day(w, '2026-10-14').hasAttribute('aria-disabled')).toBe(false);
  });

  it('bewegt den Fokus mit Pfeiltasten, Pos1 und Ende', async () => {
    const w = await open();
    day(w, '2026-10-14').focus();
    press(w, 'ArrowRight');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-15');
    });
    expect(tabStops(w)).toEqual(['2026-10-15']);
    press(w, 'ArrowDown');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-22');
    });
    press(w, 'ArrowUp');
    press(w, 'ArrowLeft');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-14');
    });
    press(w, 'Home');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-12');
    });
    press(w, 'End');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-18');
    });
    // Fokuswechsel wählt keinen Tag und lädt keine Uhrzeiten.
    expect(w.calls.filter((c) => c.url.pathname.endsWith('/slots'))).toHaveLength(1);
  });

  it('wechselt über den Monatsrand und mit Bild auf/ab den Monat', async () => {
    const w = await open();
    day(w, '2026-10-28').focus();
    press(w, 'ArrowDown');
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-month-title')?.textContent).toBe('November 2026');
      expect(focused(w)).toBe('2026-11-04');
    });
    press(w, 'PageUp');
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-month-title')?.textContent).toBe('Oktober 2026');
      expect(focused(w)).toBe('2026-10-04');
    });
    day(w, '2026-10-31').focus();
    press(w, 'PageDown');
    // 31.10. → 30.11. (kürzerer Monat)
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-11-30');
    });
  });

  it('bleibt an der Grenze des ersten Monats stehen', async () => {
    const w = await open();
    day(w, '2026-10-01').focus();
    press(w, 'ArrowLeft');
    press(w, 'PageUp');
    await vi.waitFor(() => {
      expect(focused(w)).toBe('2026-10-01');
    });
    expect(w.$('.fw-booking-month-title')?.textContent).toBe('Oktober 2026');
  });

  it('wählt mit Klick bzw. Enter nur verfügbare Tage', async () => {
    const w = await open();
    click(day(w, '2026-10-15'));
    expect(day(w, '2026-10-15').getAttribute('aria-pressed')).toBe('false');
    expect(w.calls.filter((c) => c.url.pathname.endsWith('/slots'))).toHaveLength(1);
    click(day(w, '2026-10-28'));
    expect(day(w, '2026-10-28').getAttribute('aria-pressed')).toBe('true');
    expect(tabStops(w)).toEqual(['2026-10-28']);
    await vi.waitFor(() => {
      expect(w.calls.filter((c) => c.url.pathname.endsWith('/slots'))).toHaveLength(2);
    });
  });

  it('ignoriert andere Tasten', async () => {
    const w = await open();
    day(w, '2026-10-14').focus();
    const event = new w.win.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    day(w, '2026-10-14').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focused(w)).toBe('2026-10-14');
  });
});

describe('Uhrzeiten per Tastatur', () => {
  const manySlots = {
    ...routes,
    [`/services/${HAIRCUT}/slots`]: () =>
      slotsResponse([
        slot('2026-10-14T07:00:00Z'),
        slot('2026-10-14T07:05:00Z'),
        slot('2026-10-14T10:00:00Z'),
        slot('2026-10-14T16:00:00Z'),
      ]),
  };

  function slotStops(w: Widget): string[] {
    return w
      .$$('.fw-booking-slot')
      .filter((n) => n.tabIndex === 0)
      .map((n) => n.textContent);
  }

  it('haben einen Tab-Stopp und wechseln mit Pfeiltasten über die Tageszeiten hinweg', async () => {
    const w = await mount(manySlots);
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(4);
    });
    expect(slotStops(w)).toEqual(['09:00']);
    w.$('.fw-booking-slot')?.focus();
    press(w, 'ArrowRight');
    expect(w.win.document.activeElement?.textContent).toBe('09:05');
    press(w, 'ArrowDown');
    expect(w.win.document.activeElement?.textContent).toBe('12:00');
    press(w, 'End');
    expect(w.win.document.activeElement?.textContent).toBe('18:00');
    press(w, 'ArrowRight');
    expect(w.win.document.activeElement?.textContent).toBe('18:00');
    press(w, 'Home');
    press(w, 'ArrowUp');
    expect(w.win.document.activeElement?.textContent).toBe('09:00');
    expect(slotStops(w)).toEqual(['09:00']);
    // Auswahl verschiebt den Tab-Stopp auf die gewählte Uhrzeit.
    click(w.$$('.fw-booking-slot')[2] ?? null);
    expect(slotStops(w)).toEqual(['12:00']);
    expect(w.instance.selection).toMatchObject({ startsAt: '2026-10-14T10:00:00Z' });
  });
});

describe('Tab-Reihenfolge', () => {
  it('verwendet nur native Bedienelemente und keine positiven tabindex-Werte', async () => {
    const w = await open();
    click(w.$('.fw-booking-slot'));
    click(w.$('.fw-booking-continue'));
    for (const node of w.$$('[tabindex]')) {
      expect(['-1', '0']).toContain(node.getAttribute('tabindex'));
    }
    const interactive = w.$$('button, input, a[href], select, textarea');
    expect(interactive.length).toBeGreaterThan(0);
    for (const node of w.$$('[onclick], [role="button"]')) {
      expect(node.tagName).toBe('BUTTON');
    }
  });
});
