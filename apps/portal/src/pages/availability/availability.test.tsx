import type { AvailabilityException, OpeningHoursResponse } from '@fw-booking/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../api/client.js';
import { SESSION, fakeFetch, json, renderPortal, withSession } from '../../test-utils.js';
import type { Call, Handler } from '../../test-utils.js';

const HOURS: OpeningHoursResponse = {
  timeZone: 'Europe/Berlin',
  days: [
    {
      weekday: 1,
      windows: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    },
  ],
};

const VACATION: AvailabilityException = {
  id: '66f1a2b3c4d5e6f708192b01',
  kind: 'closed',
  start: '2026-12-21T00:00',
  end: '2026-12-25T00:00',
  note: 'Urlaub',
};
const EXTRA: AvailabilityException = {
  id: '66f1a2b3c4d5e6f708192b02',
  kind: 'extra_opening',
  start: '2026-12-19T10:00',
  end: '2026-12-19T14:00',
  note: null,
};

const ok =
  (body: unknown): Handler =>
  () =>
    json(body);

function setup(handlers: Record<string, Handler | Handler[]> = {}) {
  const { fetch, calls } = fakeFetch({
    'GET /api/auth/session': withSession,
    'GET /api/owner/opening-hours': ok(HOURS),
    'GET /api/owner/availability-exceptions': ok([EXTRA, VACATION]),
    ...handlers,
  });
  const rendered = renderPortal('/oeffnungszeiten', fetch);
  return { ...rendered, calls, user: userEvent.setup() };
}

function writes(calls: Call[]): Call[] {
  return calls.filter((call) => call.method !== 'GET');
}

function day(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

describe('Wochenplan', () => {
  it('zeigt Tage, Zeitfenster und Zeitzone; ohne Änderung ist Speichern gesperrt', async () => {
    setup();
    const monday = await screen.findByRole('group', { name: 'Montag' });
    expect(within(monday).getByRole('checkbox', { name: 'Geöffnet' })).toBeChecked();
    expect(within(monday).getByLabelText('Montag, Zeitfenster 1: von')).toHaveValue('09:00');
    expect(within(monday).getByLabelText('Montag, Zeitfenster 2: bis')).toHaveValue('18:00');
    expect(within(day('Dienstag')).getByRole('checkbox', { name: 'Geöffnet' })).not.toBeChecked();
    expect(screen.getByText('Europe/Berlin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Öffnungszeiten speichern' })).toBeDisabled();
  });

  it('öffnet einen Tag, ändert Zeiten und speichert den ganzen Plan mit CSRF-Token', async () => {
    const saved: OpeningHoursResponse = {
      ...HOURS,
      days: [...HOURS.days, { weekday: 2, windows: [{ start: '09:00', end: '16:30' }] }],
    };
    const { user, calls } = setup({ 'PUT /api/owner/opening-hours': ok(saved) });
    await screen.findByRole('group', { name: 'Montag' });

    await user.click(within(day('Dienstag')).getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Dienstag, Zeitfenster 1: bis'), {
      target: { value: '16:30' },
    });
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));

    expect(await screen.findByText('Öffnungszeiten gespeichert.')).toBeInTheDocument();
    const [put] = writes(calls);
    expect(put?.body).toEqual({ days: saved.days });
    expect(put?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
    expect(screen.getByRole('button', { name: 'Öffnungszeiten speichern' })).toBeDisabled();
  });

  it('speichert „bis Mitternacht“ als 24:00', async () => {
    const { user, calls } = setup({ 'PUT /api/owner/opening-hours': ok(HOURS) });
    await screen.findByRole('group', { name: 'Montag' });
    await user.click(screen.getByLabelText('Montag, Zeitfenster 2: bis Mitternacht'));
    expect(screen.queryByLabelText('Montag, Zeitfenster 2: bis')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));
    await waitFor(() => {
      expect(writes(calls)[0]?.body).toEqual({
        days: [
          {
            weekday: 1,
            windows: [
              { start: '09:00', end: '12:00' },
              { start: '13:00', end: '24:00' },
            ],
          },
        ],
      });
    });
  });

  it('fügt Zeitfenster hinzu und entfernt sie; ohne Zeitfenster ist der Tag geschlossen', async () => {
    const { user } = setup();
    await screen.findByRole('group', { name: 'Montag' });
    await user.click(screen.getByRole('button', { name: 'Montag: Zeitfenster hinzufügen' }));
    expect(screen.getByLabelText('Montag, Zeitfenster 3: von')).toHaveValue('19:00');

    for (const n of [3, 2, 1]) {
      await user.click(
        screen.getByRole('button', { name: `Montag, Zeitfenster ${String(n)} entfernen` }),
      );
    }
    expect(within(day('Montag')).getByRole('checkbox', { name: 'Geöffnet' })).not.toBeChecked();
  });

  it('prüft vor dem Speichern und markiert fehlerhafte Felder', async () => {
    const { user, calls } = setup();
    await screen.findByRole('group', { name: 'Montag' });
    const end = screen.getByLabelText('Montag, Zeitfenster 1: bis');
    fireEvent.change(end, { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Montag, Zeitfenster 2: von'), {
      target: { value: '13:03' },
    });
    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));

    expect(screen.getByText('Das Ende muss nach dem Beginn liegen.')).toBeVisible();
    expect(screen.getByText('Nur 5-Minuten-Schritte (z. B. 09:05).')).toBeVisible();
    expect(end).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => {
      expect(end).toHaveFocus();
    });
    expect(writes(calls)).toHaveLength(0);
  });

  it('meldet Überschneidungen am Tag', async () => {
    const { user, calls } = setup();
    await screen.findByRole('group', { name: 'Montag' });
    fireEvent.change(screen.getByLabelText('Montag, Zeitfenster 2: von'), {
      target: { value: '11:00' },
    });
    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));
    expect(screen.getByText('Die Zeitfenster dieses Tages überschneiden sich.')).toBeVisible();
    expect(writes(calls)).toHaveLength(0);

    // Nach der Korrektur verschwindet die Meldung des Tages.
    fireEvent.change(screen.getByLabelText('Montag, Zeitfenster 2: von'), {
      target: { value: '13:00' },
    });
    expect(
      screen.queryByText('Die Zeitfenster dieses Tages überschneiden sich.'),
    ).not.toBeInTheDocument();
  });

  it('überträgt einen Tag auf ausgewählte andere Tage', async () => {
    const { user, calls } = setup({ 'PUT /api/owner/opening-hours': ok(HOURS) });
    await screen.findByRole('group', { name: 'Montag' });
    await user.click(screen.getByRole('button', { name: 'Montag auf andere Tage übertragen' }));
    const panel = screen.getByRole('group', { name: 'Montag übertragen auf' });
    for (const name of ['Dienstag', 'Mittwoch']) {
      await user.click(within(panel).getByRole('checkbox', { name }));
    }
    await user.click(within(panel).getByRole('button', { name: 'Übertragen' }));
    expect(screen.queryByRole('group', { name: 'Montag übertragen auf' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mittwoch, Zeitfenster 2: bis')).toHaveValue('18:00');

    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));
    await waitFor(() => {
      const body = writes(calls)[0]?.body as { days: { weekday: number }[] } | undefined;
      expect(body?.days.map((d) => d.weekday)).toEqual([1, 2, 3]);
    });
  });

  it('verwirft ungespeicherte Änderungen', async () => {
    const { user } = setup();
    await screen.findByRole('group', { name: 'Montag' });
    await user.click(within(day('Montag')).getByRole('checkbox', { name: 'Geöffnet' }));
    await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }));
    expect(within(day('Montag')).getByRole('checkbox', { name: 'Geöffnet' })).toBeChecked();
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument();
  });

  it('meldet Fehler beim Speichern und behält die Eingaben', async () => {
    const { user } = setup({
      'PUT /api/owner/opening-hours': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await screen.findByRole('group', { name: 'Montag' });
    await user.click(within(day('Sonntag')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Öffnungszeiten speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Öffnungszeiten wurden nicht gespeichert. Der Server ist nicht erreichbar.',
    );
    expect(within(day('Sonntag')).getByRole('checkbox', { name: 'Geöffnet' })).toBeChecked();
  });
});

describe('Ausnahmen', () => {
  it('listet anstehende Ausnahmen mit Art, Zeitraum und Notiz', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Sa., 19.12.2026, 10:00–14:00 Uhr');
    expect(items[0]).toHaveTextContent('Zusätzlich geöffnet');
    expect(items[1]).toHaveTextContent('Mo., 21.12.2026 – Do., 24.12.2026, ganztägig');
    expect(items[1]).toHaveTextContent('Geschlossen');
    expect(items[1]).toHaveTextContent('Urlaub');
  });

  it('zeigt einen Leerzustand', async () => {
    setup({ 'GET /api/owner/availability-exceptions': ok([]) });
    expect(await screen.findByText('Keine anstehenden Ausnahmen.')).toBeInTheDocument();
  });

  it('legt Urlaub ganztägig an und warnt vor betroffenen Buchungen', async () => {
    const created: AvailabilityException = {
      id: '66f1a2b3c4d5e6f708192b03',
      kind: 'closed',
      start: '2027-01-04T00:00',
      end: '2027-01-09T00:00',
      note: 'Skiurlaub',
    };
    const { user, calls } = setup({
      'POST /api/owner/availability-exceptions': () =>
        json({ exception: created, conflictingBookings: 2 }, 201),
    });
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });

    fireEvent.change(screen.getByLabelText('Von (Datum)'), { target: { value: '2027-01-04' } });
    fireEvent.change(screen.getByLabelText('Bis einschließlich (Datum)'), {
      target: { value: '2027-01-08' },
    });
    await user.type(screen.getByLabelText('Notiz (optional, nur intern)'), 'Skiurlaub');
    await user.click(screen.getByRole('button', { name: 'Ausnahme hinzufügen' }));

    expect(
      await screen.findByText(/2 bestätigte Buchungen liegen im gesperrten Zeitraum/),
    ).toBeVisible();
    const [post] = writes(calls);
    expect(post?.body).toEqual({
      kind: 'closed',
      start: '2027-01-04T00:00',
      end: '2027-01-09T00:00',
      note: 'Skiurlaub',
    });
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
    const items = within(screen.getByRole('list', { name: 'Anstehende Ausnahmen' })).getAllByRole(
      'listitem',
    );
    expect(items.at(-1)).toHaveTextContent('Mo., 04.01.2027 – Fr., 08.01.2027, ganztägig');
    expect(screen.getByLabelText('Notiz (optional, nur intern)')).toHaveValue('');
  });

  it('legt eine zusätzliche Öffnung mit Uhrzeiten an', async () => {
    const created: AvailabilityException = { ...EXTRA, id: '66f1a2b3c4d5e6f708192b04' };
    const { user, calls } = setup({
      'POST /api/owner/availability-exceptions': () =>
        json({ exception: created, conflictingBookings: 0 }, 201),
    });
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    await user.click(screen.getByRole('radio', { name: /Zusätzlich geöffnet/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Ganztägig' }));
    fireEvent.change(screen.getByLabelText('Beginn (Datum)'), { target: { value: '2026-12-19' } });
    fireEvent.change(screen.getByLabelText('Beginn (Uhrzeit)'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Ende (Datum)'), { target: { value: '2026-12-19' } });
    fireEvent.change(screen.getByLabelText('Ende (Uhrzeit)'), { target: { value: '14:00' } });
    await user.click(screen.getByRole('button', { name: 'Ausnahme hinzufügen' }));

    expect(await screen.findByText('Ausnahme angelegt.')).toBeVisible();
    expect(writes(calls)[0]?.body).toEqual({
      kind: 'extra_opening',
      start: '2026-12-19T10:00',
      end: '2026-12-19T14:00',
      note: null,
    });
  });

  it('prüft Eingaben vor dem Anlegen', async () => {
    const { user, calls } = setup();
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    fireEvent.change(screen.getByLabelText('Von (Datum)'), { target: { value: '2027-01-10' } });
    fireEvent.change(screen.getByLabelText('Bis einschließlich (Datum)'), {
      target: { value: '2027-01-05' },
    });
    await user.click(screen.getByRole('button', { name: 'Ausnahme hinzufügen' }));
    expect(screen.getByText('Das Ende darf nicht vor dem Beginn liegen.')).toBeVisible();
    expect(writes(calls)).toHaveLength(0);
  });

  it('übernimmt das Startdatum ins Enddatum, wenn es sonst davor läge', async () => {
    setup();
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    fireEvent.change(screen.getByLabelText('Von (Datum)'), { target: { value: '2030-05-01' } });
    expect(screen.getByLabelText('Bis einschließlich (Datum)')).toHaveValue('2030-05-01');
  });

  it('entfernt eine Ausnahme erst nach Rückfrage', async () => {
    const { user, calls } = setup({
      [`DELETE /api/owner/availability-exceptions/${VACATION.id}`]: () =>
        new Response(null, { status: 204 }),
    });
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    const range = 'Mo., 21.12.2026 – Do., 24.12.2026, ganztägig';

    await user.click(screen.getByRole('button', { name: `Ausnahme ${range} entfernen` }));
    expect(screen.getByText('Wirklich entfernen?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(writes(calls)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: `Ausnahme ${range} entfernen` }));
    await user.click(screen.getByRole('button', { name: `Ausnahme ${range} endgültig entfernen` }));

    expect(await screen.findByText('Ausnahme entfernt.')).toBeVisible();
    expect(screen.queryByText(range)).not.toBeInTheDocument();
    const [del] = writes(calls);
    expect(del?.method).toBe('DELETE');
    expect(del?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('meldet Fehler beim Entfernen am Eintrag', async () => {
    const { user } = setup({
      [`DELETE /api/owner/availability-exceptions/${EXTRA.id}`]: () =>
        json({ statusCode: 500, message: 'x' }, 500),
    });
    await screen.findByRole('list', { name: 'Anstehende Ausnahmen' });
    const range = 'Sa., 19.12.2026, 10:00–14:00 Uhr';
    await user.click(screen.getByRole('button', { name: `Ausnahme ${range} entfernen` }));
    await user.click(screen.getByRole('button', { name: `Ausnahme ${range} endgültig entfernen` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nicht entfernt.');
    expect(screen.getByText(range)).toBeInTheDocument();
  });
});
