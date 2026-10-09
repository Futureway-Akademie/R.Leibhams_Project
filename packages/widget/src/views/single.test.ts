import { describe, expect, it, vi } from 'vitest';
import type { Selection } from '../app.js';
import {
  HAIRCUT,
  TZ,
  YOGA,
  click,
  datesResponse,
  json,
  mount,
  service,
  slot,
  slotsResponse,
} from '../test-utils.js';
import type { Handler } from '../test-utils.js';
import { MAX_MONTHS_AHEAD } from './single.js';

// NOW (test-utils) ist 2026-10-11 22:30 UTC = Montag, 12.10.2026 in Berlin.
const haircutOnly = {
  '/services': () => json({ timeZone: TZ, services: [service(HAIRCUT, 'Haarschnitt', 'single')] }),
};
const DATES = `/services/${HAIRCUT}/available-dates`;
const SLOTS = `/services/${HAIRCUT}/slots`;

async function openSingle(routes: Record<string, Handler | Handler[]>) {
  const w = await mount({ ...haircutOnly, ...routes });
  return w;
}

function dayButton(w: Awaited<ReturnType<typeof mount>>, date: string): HTMLButtonElement {
  const node = w.$(`.fw-booking-day[data-date="${date}"]`);
  if (!(node instanceof w.win.HTMLButtonElement)) throw new Error(`Tag ${date} fehlt`);
  return node;
}

function queries(w: Awaited<ReturnType<typeof mount>>, path: string) {
  return w.calls
    .filter((c) => c.url.pathname.endsWith(path))
    .map((c) => Object.fromEntries(c.url.searchParams));
}

describe('Einzeltermin-Ansicht', () => {
  it('zeigt den aktuellen Monat mit wählbaren freien Tagen', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14', '2026-10-20']),
      [SLOTS]: () => slotsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-day')).toHaveLength(31);
    });
    expect(queries(w, DATES)).toEqual([{ from: '2026-10-12', to: '2026-10-31' }]);
    expect(w.$('.fw-booking-month-title')?.textContent).toBe('Oktober 2026');
    expect(w.text('.fw-booking-weekday')).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    // Eine Zeile je Woche; der 1.10.2026 ist ein Donnerstag: drei leere Zellen davor.
    const weeks = w.$$('.fw-booking-week');
    expect(weeks).toHaveLength(5);
    for (const week of weeks) expect(week.children).toHaveLength(7);
    expect(weeks[0]?.querySelectorAll('.fw-booking-day-empty')).toHaveLength(3);
    expect(weeks[0]?.querySelector('.fw-booking-day')?.textContent).toBe('1');
    expect(weeks[4]?.querySelectorAll('.fw-booking-day-empty')).toHaveLength(1);
    expect(w.$('th.fw-booking-weekday')?.getAttribute('abbr')).toBe('Montag');
    const free = w.$$('.fw-booking-day').filter((n) => !n.hasAttribute('aria-disabled'));
    expect(free.map((n) => n.dataset['date'])).toEqual(['2026-10-14', '2026-10-20']);
    expect(dayButton(w, '2026-10-12').getAttribute('aria-current')).toBe('date');
    expect(dayButton(w, '2026-10-14').getAttribute('aria-label')).toBe(
      'Mittwoch, 14. Oktober 2026',
    );
    expect((w.$('.fw-booking-month-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((w.$('.fw-booking-month-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('wählt den ersten freien Tag vor und zeigt dessen Uhrzeiten nach Tageszeit', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-20', '2026-10-14']),
      [SLOTS]: () =>
        slotsResponse([
          slot('2026-10-14T07:00:00Z'),
          slot('2026-10-14T09:55:00Z'),
          slot('2026-10-14T10:00:00Z'),
          slot('2026-10-14T15:55:00Z'),
          slot('2026-10-14T16:00:00Z'),
        ]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(5);
    });
    expect(queries(w, SLOTS)).toEqual([{ date: '2026-10-14' }]);
    expect(dayButton(w, '2026-10-14').getAttribute('aria-pressed')).toBe('true');
    expect(w.$('.fw-booking-slots-title')?.textContent).toBe('Mittwoch, 14. Oktober 2026');
    expect(w.text('.fw-booking-slot-group-title')).toEqual(['Vormittag', 'Nachmittag', 'Abend']);
    const group = (key: string) =>
      [...(w.$(`.fw-booking-slot-group--${key}`)?.querySelectorAll('.fw-booking-slot') ?? [])].map(
        (n) => n.textContent,
      );
    expect(group('morning')).toEqual(['09:00', '11:55']);
    expect(group('afternoon')).toEqual(['12:00', '17:55']);
    expect(group('evening')).toEqual(['18:00']);
    expect(w.$$('.fw-booking-slot')[2]?.getAttribute('aria-label')).toBe('12:00–12:30');
    // Vorauswahl eines Tages ist noch keine Terminauswahl.
    expect(w.instance.selection).toBeNull();
    expect(w.events).toEqual([]);
  });

  it('blendet leere Tageszeiten aus und rechnet nach der Zeitumstellung richtig', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-26']),
      [SLOTS]: () => slotsResponse([slot('2026-10-26T08:00:00Z'), slot('2026-10-26T16:30:00Z')]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(2);
    });
    // Ab dem 25.10. gilt in Berlin UTC+1.
    expect(w.text('.fw-booking-slot')).toEqual(['09:00', '17:30']);
    expect(w.text('.fw-booking-slot-group-title')).toEqual(['Vormittag', 'Nachmittag']);
  });

  it('springt zum ersten Monat mit freien Tagen', async () => {
    const w = await openSingle({
      [DATES]: [() => datesResponse([]), () => datesResponse(['2026-11-03'])],
      [SLOTS]: () => slotsResponse([slot('2026-11-03T09:00:00Z')]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(1);
    });
    expect(queries(w, DATES)).toEqual([
      { from: '2026-10-12', to: '2026-10-31' },
      { from: '2026-11-01', to: '2026-11-30' },
    ]);
    expect(w.$('.fw-booking-month-title')?.textContent).toBe('November 2026');
    expect((w.$('.fw-booking-month-prev') as HTMLButtonElement).disabled).toBe(false);
    expect(queries(w, SLOTS)).toEqual([{ date: '2026-11-03' }]);
  });

  it('meldet, wenn im gesamten Zeitraum kein Termin frei ist', async () => {
    const w = await openSingle({ [DATES]: () => datesResponse([]) });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-calendar-status .fw-booking-message--info')?.textContent).toBe(
        'Derzeit sind keine Termine frei.',
      );
    });
    expect(queries(w, DATES)).toHaveLength(MAX_MONTHS_AHEAD);
    expect(queries(w, SLOTS)).toEqual([]);
    expect(w.$('.fw-booking-month-title')?.textContent).toBe('Oktober 2026');
    expect((w.$('.fw-booking-month-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((w.$('.fw-booking-month-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('blättert zwischen Monaten und lädt bereits bekannte Monate nicht erneut', async () => {
    const w = await openSingle({
      [DATES]: [
        () => datesResponse(['2026-10-14']),
        () => datesResponse([]),
        () => datesResponse(['2026-12-01']),
      ],
      [SLOTS]: () => slotsResponse([slot('2026-10-14T07:00:00Z')]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(1);
    });
    click(w.$('.fw-booking-month-next'));
    expect(w.$('.fw-booking-calendar-status [role="status"]')?.textContent).toBe(
      'Freie Tage werden geladen …',
    );
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-month-title')?.textContent).toBe('November 2026');
    });
    expect(w.$('.fw-booking-calendar-status')?.textContent).toBe(
      'In diesem Monat sind keine Termine frei.',
    );
    // Die Uhrzeiten des gewählten Tages bleiben sichtbar.
    expect(w.$$('.fw-booking-slot')).toHaveLength(1);
    click(w.$('.fw-booking-month-next'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-month-title')?.textContent).toBe('Dezember 2026');
    });
    click(w.$('.fw-booking-month-prev'));
    click(w.$('.fw-booking-month-prev'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-month-title')?.textContent).toBe('Oktober 2026');
    });
    expect(queries(w, DATES)).toEqual([
      { from: '2026-10-12', to: '2026-10-31' },
      { from: '2026-11-01', to: '2026-11-30' },
      { from: '2026-12-01', to: '2026-12-31' },
    ]);
    expect(dayButton(w, '2026-10-14').getAttribute('aria-pressed')).toBe('true');
  });

  it('begrenzt das Blättern auf zwölf Monate', async () => {
    const w = await openSingle({
      [DATES]: [() => datesResponse(['2026-10-14']), () => datesResponse([])],
      [SLOTS]: () => slotsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-day')).toHaveLength(31);
    });
    for (let i = 1; i < MAX_MONTHS_AHEAD; i++) {
      click(w.$('.fw-booking-month-next'));
      await vi.waitFor(() => {
        expect(queries(w, DATES)).toHaveLength(i + 1);
        expect(w.$('.fw-booking-calendar-status [role="status"]')).toBeNull();
      });
    }
    expect(w.$('.fw-booking-month-title')?.textContent).toBe('September 2027');
    expect((w.$('.fw-booking-month-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('wählt einen Slot und meldet ihn als Ereignis', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14']),
      [SLOTS]: () => slotsResponse([slot('2026-10-14T07:00:00Z'), slot('2026-10-14T07:05:00Z')]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(2);
    });
    const [first, second] = w.$$('.fw-booking-slot');
    click(first ?? null);
    const expected: Selection = {
      type: 'single',
      calendarId: 'cal_AAAAAAAAAAAAAAAA',
      serviceId: HAIRCUT,
      startsAt: '2026-10-14T07:00:00Z',
      endsAt: '2026-10-14T07:30:00Z',
      timeZone: TZ,
    };
    expect(w.instance.selection).toEqual(expected);
    expect(w.events).toEqual([expected]);
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(first?.classList.contains('fw-booking-slot--selected')).toBe(true);

    click(second ?? null);
    expect(w.instance.selection).toMatchObject({ startsAt: '2026-10-14T07:05:00Z' });
    expect(first?.getAttribute('aria-pressed')).toBe('false');
    expect(second?.getAttribute('aria-pressed')).toBe('true');
  });

  it('setzt die Auswahl beim Tageswechsel zurück und lädt die Uhrzeiten neu', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14', '2026-10-15']),
      [SLOTS]: (url) => slotsResponse([slot(`${url.searchParams.get('date') ?? ''}T07:00:00Z`)]),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(1);
    });
    click(w.$('.fw-booking-slot'));
    click(dayButton(w, '2026-10-15'));
    expect(w.instance.selection).toBeNull();
    expect(w.events.at(-1)).toBeNull();
    expect(dayButton(w, '2026-10-14').getAttribute('aria-pressed')).toBe('false');
    expect(dayButton(w, '2026-10-15').getAttribute('aria-pressed')).toBe('true');
    expect(w.$('.fw-booking-slots [role="status"]')?.textContent).toBe(
      'Freie Uhrzeiten werden geladen …',
    );
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots-title')?.textContent).toBe('Donnerstag, 15. Oktober 2026');
    });
    expect(queries(w, SLOTS)).toEqual([{ date: '2026-10-14' }, { date: '2026-10-15' }]);
    // Erneuter Klick auf denselben Tag lädt nicht noch einmal.
    click(dayButton(w, '2026-10-15'));
    expect(queries(w, SLOTS)).toHaveLength(2);
  });

  it('bricht beim schnellen Tageswechsel die vorherige Abfrage ab', async () => {
    let answerFirst: (response: Response) => void = () => undefined;
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14', '2026-10-15']),
      [SLOTS]: [
        () =>
          new Promise<Response>((resolve) => {
            answerFirst = resolve;
          }),
        () => slotsResponse([slot('2026-10-15T08:00:00Z')]),
      ],
    });
    await vi.waitFor(() => {
      expect(queries(w, SLOTS)).toHaveLength(1);
    });
    click(dayButton(w, '2026-10-15'));
    await vi.waitFor(() => {
      expect(w.text('.fw-booking-slot')).toEqual(['10:00']);
    });
    const firstCall = w.calls.find((c) => c.url.searchParams.get('date') === '2026-10-14');
    expect(firstCall?.signal?.aborted).toBe(true);
    // Eine verspätete Antwort für den 14. überschreibt die Anzeige nicht.
    answerFirst(slotsResponse([slot('2026-10-14T07:00:00Z')]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(w.text('.fw-booking-slot')).toEqual(['10:00']);
  });

  it('zeigt einen Hinweis, wenn ein Tag inzwischen keine Uhrzeiten mehr hat', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14']),
      [SLOTS]: () => slotsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots .fw-booking-message--info')?.textContent).toBe(
        'An diesem Tag sind inzwischen keine Uhrzeiten mehr frei. Bitte wähle einen anderen Tag.',
      );
    });
  });

  it('zeigt Fehler beim Laden der Uhrzeiten mit erneutem Versuch', async () => {
    const w = await openSingle({
      [DATES]: () => datesResponse(['2026-10-14']),
      [SLOTS]: [
        () => Promise.reject(new TypeError('Failed to fetch')),
        () => slotsResponse([slot('2026-10-14T07:00:00Z')]),
      ],
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots [role="alert"]')).not.toBeNull();
    });
    click(w.$('.fw-booking-slots .fw-booking-retry'));
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-slot')).toHaveLength(1);
    });
    expect(queries(w, SLOTS)).toEqual([{ date: '2026-10-14' }, { date: '2026-10-14' }]);
  });

  it('zeigt Fehler beim Laden der freien Tage mit erneutem Versuch', async () => {
    const w = await openSingle({
      [DATES]: [
        () => json({ statusCode: 500, message: 'intern' }, 500),
        () => datesResponse(['2026-10-14']),
      ],
      [SLOTS]: () => slotsResponse([]),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-calendar-status [role="alert"]')).not.toBeNull();
    });
    click(w.$('.fw-booking-calendar-status .fw-booking-retry'));
    await vi.waitFor(() => {
      expect(dayButton(w, '2026-10-14').getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('zeigt die Ladezustände für Tage und Uhrzeiten', async () => {
    const w = await openSingle({
      [DATES]: [() => new Promise<Response>(() => undefined)],
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-calendar-status [role="status"]')?.textContent).toBe(
        'Freie Tage werden geladen …',
      );
    });
    expect((w.$('.fw-booking-month-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('bricht beim Zurück zur Angebotsliste laufende Abfragen ab', async () => {
    const w = await mount({
      '/services': () =>
        json({
          timeZone: TZ,
          services: [service(YOGA, 'Yoga'), service(HAIRCUT, 'Haarschnitt', 'single')],
        }),
      [DATES]: () => datesResponse(['2026-10-14']),
      [SLOTS]: () => new Promise<Response>(() => undefined),
    });
    await vi.waitFor(() => {
      expect(w.$$('.fw-booking-service')).toHaveLength(2);
    });
    click(w.$$('.fw-booking-service')[1] ?? null);
    await vi.waitFor(() => {
      expect(queries(w, SLOTS)).toHaveLength(1);
    });
    click(w.$('.fw-booking-back'));
    const slotsCall = w.calls.find((c) => c.url.pathname.endsWith(SLOTS));
    expect(slotsCall?.signal?.aborted).toBe(true);
    expect(w.text('.fw-booking-service-name')).toEqual(['Yoga', 'Haarschnitt']);
  });
});
