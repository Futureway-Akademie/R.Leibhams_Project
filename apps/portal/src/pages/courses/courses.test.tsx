import type { CourseRule, Service, Session } from '@fw-booking/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../api/client.js';
import { SESSION, fakeFetch, json, renderPortal, withSession } from '../../test-utils.js';
import type { Call, Handler } from '../../test-utils.js';

const TZ = 'Europe/Berlin';
const META = { createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' };
const NO_RULES = { minLeadMinutes: null, horizonDays: null, changeDeadlineMinutes: null };

const YOGA: Service = {
  id: '66f1a2b3c4d5e6f708192a01',
  type: 'group',
  title: 'Yoga',
  description: null,
  active: true,
  durationMinutes: 60,
  defaultCapacity: 12,
  bookingRules: NO_RULES,
  sortOrder: 0,
  ...META,
};
const PILATES: Service = {
  ...YOGA,
  id: '66f1a2b3c4d5e6f708192a02',
  title: 'Pilates',
  sortOrder: 1,
};
const HAIRCUT: Service = {
  id: '66f1a2b3c4d5e6f708192a03',
  type: 'single',
  title: 'Haarschnitt',
  description: null,
  active: true,
  durationMinutes: 30,
  bookingRules: NO_RULES,
  sortOrder: 2,
  ...META,
};

// Woche vom 14. bis 20.10.2030 (Sommerzeit, UTC+2).
const WEEK = '2030-10-14';
const WEEK_QUERY = '/api/owner/sessions?from=2030-10-14&to=2030-10-20&includeCancelled=true';

const MONDAY: Session = {
  id: '66f1a2b3c4d5e6f708192d01',
  serviceId: YOGA.id,
  ruleId: '66f1a2b3c4d5e6f708192c01',
  startsAt: '2030-10-14T16:00:00Z',
  endsAt: '2030-10-14T17:00:00Z',
  timeZone: TZ,
  capacity: 12,
  bookedCount: 7,
  status: 'scheduled',
  location: 'Raum 1',
  cancellationReason: null,
};
const FULL: Session = {
  ...MONDAY,
  id: '66f1a2b3c4d5e6f708192d02',
  serviceId: PILATES.id,
  ruleId: null,
  startsAt: '2030-10-16T08:00:00Z',
  endsAt: '2030-10-16T09:00:00Z',
  capacity: 8,
  bookedCount: 8,
  location: null,
};
const CANCELLED: Session = {
  ...MONDAY,
  id: '66f1a2b3c4d5e6f708192d03',
  startsAt: '2030-10-18T16:00:00Z',
  endsAt: '2030-10-18T17:00:00Z',
  bookedCount: 0,
  status: 'cancelled',
  cancellationReason: 'Krank',
};
const EMPTY: Session = {
  ...MONDAY,
  id: '66f1a2b3c4d5e6f708192d04',
  ruleId: null,
  bookedCount: 0,
  location: null,
};

const RULE: CourseRule = {
  id: '66f1a2b3c4d5e6f708192c01',
  serviceId: YOGA.id,
  weekdays: [1, 3],
  startTime: '18:00',
  validFrom: '2030-10-01',
  validUntil: null,
  capacity: null,
  location: 'Raum 1',
};

const ok =
  (body: unknown): Handler =>
  () =>
    json(body);

function setup(path: string, handlers: Record<string, Handler | Handler[]> = {}) {
  const { fetch, calls } = fakeFetch({
    'GET /api/auth/session': withSession,
    'GET /api/owner/calendar': ok({ calendarId: 'cal_AAAAAAAAAAAAAAAA', timeZone: TZ }),
    'GET /api/owner/services': ok([YOGA, PILATES, HAIRCUT]),
    [`GET ${WEEK_QUERY}`]: ok([MONDAY, FULL, CANCELLED]),
    ...handlers,
  });
  const rendered = renderPortal(path, fetch);
  return { ...rendered, calls, user: userEvent.setup() };
}

const writes = (calls: Call[]): Call[] => calls.filter((call) => call.method !== 'GET');

describe('Kurstermine: Wochenansicht', () => {
  it('zeigt Termine nach Tagen mit Belegung, Status und Regelherkunft', async () => {
    setup(`/kurstermine?woche=${WEEK}`);
    expect(await screen.findByRole('heading', { name: 'KW 42 · 14.10.–20.10.2030' })).toBeVisible();

    const monday = await screen.findByRole('region', { name: 'Mo., 14.10.2030' });
    expect(within(monday).getByRole('link', { name: '18:00–19:00 Uhr · Yoga' })).toHaveAttribute(
      'href',
      `/kurstermine/${MONDAY.id}`,
    );
    expect(monday).toHaveTextContent('7 / 12 Plätze');
    expect(monday).toHaveTextContent('Raum 1');
    expect(monday).toHaveTextContent('Regel');

    const wednesday = screen.getByRole('region', { name: 'Mi., 16.10.2030' });
    expect(wednesday).toHaveTextContent('8 / 8 Plätze · ausgebucht');

    const friday = screen.getByRole('region', { name: 'Fr., 18.10.2030' });
    expect(friday).toHaveTextContent('Abgesagt');
    expect(friday).not.toHaveTextContent('Plätze');
    expect(screen.getByRole('link', { name: 'Termine' })).toHaveAttribute('aria-current', 'page');
  });

  it('blättert wochenweise und merkt sich die Woche in der Adresse', async () => {
    const { user, router } = setup(`/kurstermine?woche=${WEEK}`, {
      'GET /api/owner/sessions?from=2030-10-21&to=2030-10-27&includeCancelled=true': ok([]),
    });
    await screen.findByRole('region', { name: 'Mo., 14.10.2030' });
    await user.click(screen.getByRole('button', { name: 'Nächste Woche' }));
    expect(await screen.findByText('Keine Kurstermine in dieser Woche.')).toBeVisible();
    expect(router.state.location.search).toBe('?woche=2030-10-21');
    expect(screen.getByRole('heading', { name: 'KW 43 · 21.10.–27.10.2030' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Vorherige Woche' }));
    expect(await screen.findByRole('region', { name: 'Mo., 14.10.2030' })).toBeVisible();
  });

  it('filtert nach Gruppenkurs und bietet nur Gruppenkurse an', async () => {
    const { user } = setup(`/kurstermine?woche=${WEEK}`);
    await screen.findByRole('region', { name: 'Mo., 14.10.2030' });
    const select = screen.getByRole('combobox', { name: 'Angebot' });
    expect(within(select).queryByRole('option', { name: 'Haarschnitt' })).not.toBeInTheDocument();
    await user.selectOptions(select, 'Pilates');
    expect(screen.queryByRole('region', { name: 'Mo., 14.10.2030' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mi., 16.10.2030' })).toBeVisible();
  });
});

describe('Kurstermin anlegen', () => {
  it('legt einen Termin in lokaler Zeit an und zeigt ihn in seiner Woche', async () => {
    const created: Session = { ...EMPTY, id: '66f1a2b3c4d5e6f708192d09' };
    const { user, calls, router } = setup('/kurstermine/neu', {
      'POST /api/owner/sessions': () => json(created, 201),
    });
    const select = await screen.findByRole('combobox', { name: 'Gruppenkurs' });
    expect(within(select).queryByRole('option', { name: 'Haarschnitt' })).not.toBeInTheDocument();
    await user.selectOptions(select, 'Yoga');
    fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2030-10-14' } });
    fireEvent.change(screen.getByLabelText('Beginn'), { target: { value: '18:00' } });
    expect(screen.getByText(/Standard des Angebots \(12 Plätze\)/)).toBeVisible();
    await user.type(screen.getByLabelText('Ort (optional)'), 'Raum 2');
    await user.click(screen.getByRole('button', { name: 'Kurstermin anlegen' }));

    expect(
      await screen.findByText('Kurstermin am Mo., 14.10.2030, 18:00 Uhr angelegt.'),
    ).toBeVisible();
    expect(router.state.location.search).toBe('?woche=2030-10-14');
    const [post] = writes(calls);
    expect(post?.body).toEqual({
      serviceId: YOGA.id,
      startsAt: '2030-10-14T16:00:00Z',
      capacity: null,
      location: 'Raum 2',
    });
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('meldet Konflikte der API verständlich', async () => {
    const { user } = setup('/kurstermine/neu', {
      'POST /api/owner/sessions': () =>
        json({ statusCode: 409, message: 'Der Zeitraum ist bereits belegt' }, 409),
    });
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Gruppenkurs' }), 'Yoga');
    fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2030-10-14' } });
    await user.click(screen.getByRole('button', { name: 'Kurstermin anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Kurstermin wurde nicht angelegt. Der Zeitraum ist bereits belegt',
    );
  });
});

describe('Kurstermin: Detailseite', () => {
  it('zeigt Belegung und sperrt die Uhrzeit bei vorhandenen Buchungen', async () => {
    setup(`/kurstermine/${MONDAY.id}`, {
      [`GET /api/owner/sessions/${MONDAY.id}`]: ok(MONDAY),
    });
    expect(await screen.findByRole('heading', { name: 'Yoga' })).toBeVisible();
    expect(screen.getByText('7 / 12 Plätze')).toBeVisible();
    expect(screen.getByText('Aus wiederkehrender Regel')).toBeVisible();
    expect(screen.getByLabelText('Beginn')).toBeDisabled();
    expect(screen.getByText(/bitte absagen und neu anlegen/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kurstermin löschen …' })).not.toBeInTheDocument();
  });

  it('ändert Kapazität und Ort als Teiländerung', async () => {
    const { user, calls } = setup(`/kurstermine/${MONDAY.id}`, {
      [`GET /api/owner/sessions/${MONDAY.id}`]: ok(MONDAY),
      [`PATCH /api/owner/sessions/${MONDAY.id}`]: () =>
        json({ ...MONDAY, capacity: 15, location: null }),
    });
    const capacity = await screen.findByLabelText('Plätze');
    await user.clear(capacity);
    await user.type(capacity, '15');
    await user.clear(screen.getByLabelText('Ort (optional)'));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Änderungen gespeichert.')).toBeVisible();
    expect(writes(calls)[0]?.body).toEqual({ capacity: 15, location: null });
  });

  it('lässt die Kapazität nicht unter die gebuchten Plätze sinken', async () => {
    const { user, calls } = setup(`/kurstermine/${MONDAY.id}`, {
      [`GET /api/owner/sessions/${MONDAY.id}`]: ok(MONDAY),
    });
    const capacity = await screen.findByLabelText('Plätze');
    await user.clear(capacity);
    await user.type(capacity, '5');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByText('Mindestens 7 Plätze (bereits gebucht).')).toBeVisible();
    expect(writes(calls)).toHaveLength(0);
  });

  it('verschiebt einen Termin ohne Buchungen', async () => {
    const { user, calls } = setup(`/kurstermine/${EMPTY.id}`, {
      [`GET /api/owner/sessions/${EMPTY.id}`]: ok(EMPTY),
      [`PATCH /api/owner/sessions/${EMPTY.id}`]: () =>
        json({ ...EMPTY, startsAt: '2030-10-15T07:30:00Z', endsAt: '2030-10-15T08:30:00Z' }),
    });
    const date = await screen.findByLabelText('Datum');
    fireEvent.change(date, { target: { value: '2030-10-15' } });
    fireEvent.change(screen.getByLabelText('Beginn'), { target: { value: '09:30' } });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => {
      expect(writes(calls)[0]?.body).toEqual({ startsAt: '2030-10-15T07:30:00Z' });
    });
  });

  it('sperrt und entsperrt einen Termin', async () => {
    const { user, calls } = setup(`/kurstermine/${MONDAY.id}`, {
      [`GET /api/owner/sessions/${MONDAY.id}`]: ok(MONDAY),
      [`PATCH /api/owner/sessions/${MONDAY.id}`]: [
        () => json({ ...MONDAY, status: 'blocked' }),
        () => json(MONDAY),
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Für neue Buchungen sperren' }));
    await user.click(await screen.findByRole('button', { name: 'Sperre aufheben' }));
    await screen.findByRole('button', { name: 'Für neue Buchungen sperren' });
    expect(writes(calls).map((c) => c.body)).toEqual([
      { status: 'blocked' },
      { status: 'scheduled' },
    ]);
  });

  it('sagt erst nach Bestätigung ab und nennt betroffene Buchungen', async () => {
    const { user, calls } = setup(`/kurstermine/${MONDAY.id}`, {
      [`GET /api/owner/sessions/${MONDAY.id}`]: ok(MONDAY),
      [`POST /api/owner/sessions/${MONDAY.id}/cancel`]: () =>
        json({
          session: { ...MONDAY, status: 'cancelled', bookedCount: 0, cancellationReason: 'Krank' },
          cancelledBookings: 7,
          alreadyCancelled: false,
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Kurstermin absagen …' }));
    expect(screen.getByText(/7 bestätigte Buchungen werden abgesagt/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(writes(calls)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Kurstermin absagen …' }));
    await user.type(screen.getByLabelText('Begründung (optional)'), ' Krank ');
    await user.click(screen.getByRole('button', { name: 'Verbindlich absagen' }));

    expect(await screen.findByText(/7 Buchungen wurden abgesagt/)).toBeVisible();
    expect(screen.getByText('Abgesagt')).toBeVisible();
    expect(screen.getByText('Krank')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    const [post] = writes(calls);
    expect(post?.body).toEqual({ confirm: true, reason: 'Krank' });
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('löscht Termine ohne Buchungen nach Rückfrage', async () => {
    const { user, calls, router } = setup(`/kurstermine/${EMPTY.id}`, {
      [`GET /api/owner/sessions/${EMPTY.id}`]: ok(EMPTY),
      [`DELETE /api/owner/sessions/${EMPTY.id}`]: () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Kurstermin löschen …' }));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Kurstermin gelöscht.')).toBeVisible();
    expect(router.state.location.pathname).toBe('/kurstermine');
    expect(writes(calls)[0]?.method).toBe('DELETE');
  });

  it('meldet Buchungshistorie beim Löschen', async () => {
    const { user } = setup(`/kurstermine/${EMPTY.id}`, {
      [`GET /api/owner/sessions/${EMPTY.id}`]: ok(EMPTY),
      [`DELETE /api/owner/sessions/${EMPTY.id}`]: () =>
        json(
          { statusCode: 409, message: 'Kurstermine mit Buchungen werden abgesagt, nicht gelöscht' },
          409,
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Kurstermin löschen …' }));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('bitte stattdessen absagen');
  });

  it('zeigt abgesagte Termine nur lesend mit Begründung', async () => {
    setup(`/kurstermine/${CANCELLED.id}`, {
      [`GET /api/owner/sessions/${CANCELLED.id}`]: ok(CANCELLED),
    });
    expect(await screen.findByText('Krank')).toBeVisible();
    expect(screen.getByText('Abgesagte Kurstermine können nicht geändert werden.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kurstermin absagen …' })).not.toBeInTheDocument();
  });
});

describe('Kursregeln', () => {
  it('listet Regeln mit Zusammenfassung', async () => {
    setup('/kurstermine/regeln', { 'GET /api/owner/course-rules': ok([RULE]) });
    const list = await screen.findByRole('list', { name: 'Kursregeln' });
    expect(within(list).getByRole('link', { name: 'Yoga' })).toHaveAttribute(
      'href',
      `/kurstermine/regeln/${RULE.id}`,
    );
    expect(list).toHaveTextContent('Mo, Mi · 18:00 Uhr · ab Di., 01.10.2030, unbefristet · Raum 1');
    expect(screen.getByRole('link', { name: 'Regeln' })).toHaveAttribute('aria-current', 'page');
  });

  it('legt eine Regel an und zeigt den Erzeugungsbericht', async () => {
    const { user, calls } = setup('/kurstermine/regeln/neu', {
      'POST /api/owner/course-rules': () =>
        json(
          {
            rule: { ...RULE, id: '66f1a2b3c4d5e6f708192c02', weekdays: [2, 4] },
            generation: { created: 24, conflicts: ['2030-10-17T18:00'], keptWithBookings: [] },
          },
          201,
        ),
      'GET /api/owner/course-rules': ok([RULE]),
    });
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Gruppenkurs' }), 'Yoga');
    await user.click(screen.getByRole('checkbox', { name: 'Donnerstag' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dienstag' }));
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2030-10-01' } });
    await user.click(screen.getByRole('button', { name: 'Regel anlegen' }));

    expect(await screen.findByText('Regel angelegt. 24 Kurstermine erzeugt.')).toBeVisible();
    expect(screen.getByText('Übersprungen, weil die Zeit bereits belegt ist:')).toBeVisible();
    expect(screen.getByText('Do., 17.10.2030, 18:00 Uhr')).toBeVisible();
    expect(writes(calls)[0]?.body).toEqual({
      serviceId: YOGA.id,
      weekdays: [2, 4],
      startTime: '18:00',
      validFrom: '2030-10-01',
      validUntil: null,
      capacity: null,
      location: null,
    });
  });

  it('prüft Pflichtangaben vor dem Anlegen', async () => {
    const { user, calls } = setup('/kurstermine/regeln/neu');
    await user.click(await screen.findByRole('button', { name: 'Regel anlegen' }));
    expect(screen.getByText('Bitte einen Gruppenkurs wählen.')).toBeVisible();
    expect(screen.getByText('Bitte mindestens einen Wochentag wählen.')).toBeVisible();
    expect(writes(calls)).toHaveLength(0);
  });

  it('bearbeitet eine Regel als Teiländerung', async () => {
    const { user, calls } = setup(`/kurstermine/regeln/${RULE.id}`, {
      [`GET /api/owner/course-rules/${RULE.id}`]: ok(RULE),
      [`PATCH /api/owner/course-rules/${RULE.id}`]: () =>
        json({
          rule: { ...RULE, startTime: '19:00' },
          generation: { created: 10, conflicts: [], keptWithBookings: ['2030-10-14T18:00'] },
        }),
      'GET /api/owner/course-rules': ok([RULE]),
    });
    expect(await screen.findByText('(nach dem Anlegen nicht änderbar)')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Montag' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Beginn'), { target: { value: '19:00' } });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Regel gespeichert. 10 Kurstermine erzeugt.')).toBeVisible();
    expect(screen.getByText('Mo., 14.10.2030, 18:00 Uhr')).toBeVisible();
    expect(writes(calls)[0]?.body).toEqual({ startTime: '19:00' });
  });

  it('löscht eine Regel nach Rückfrage und nennt verbleibende gebuchte Termine', async () => {
    const { user, calls } = setup(`/kurstermine/regeln/${RULE.id}`, {
      [`GET /api/owner/course-rules/${RULE.id}`]: ok(RULE),
      [`DELETE /api/owner/course-rules/${RULE.id}`]: ok({ keptWithBookings: ['2030-10-14T18:00'] }),
      'GET /api/owner/course-rules': ok([]),
    });
    await user.click(await screen.findByRole('button', { name: 'Regel löschen …' }));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Regel gelöscht.')).toBeVisible();
    expect(screen.getByText('Mo., 14.10.2030, 18:00 Uhr')).toBeVisible();
    expect(writes(calls)[0]?.method).toBe('DELETE');
  });
});
