import type { Booking, Service, Session } from '@fw-booking/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../api/client.js';
import { addDays, todayIn } from '../../availability/time.js';
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
const HAIRCUT: Service = {
  id: '66f1a2b3c4d5e6f708192a03',
  type: 'single',
  title: 'Haarschnitt',
  description: null,
  active: true,
  durationMinutes: 30,
  bookingRules: NO_RULES,
  sortOrder: 1,
  ...META,
};

const COURSE: Session = {
  id: '66f1a2b3c4d5e6f708192d01',
  serviceId: YOGA.id,
  ruleId: null,
  startsAt: '2030-10-14T16:00:00Z',
  endsAt: '2030-10-14T17:00:00Z',
  timeZone: TZ,
  capacity: 12,
  bookedCount: 2,
  status: 'scheduled',
  location: null,
  cancellationReason: null,
};

const base = {
  timeZone: TZ,
  rebookedToBookingId: null,
  ownerCancellationReason: null,
  createdAt: '2030-10-01T07:15:00Z',
};
const ANNA: Booking = {
  ...base,
  id: '66f1a2b3c4d5e6f708192e01',
  serviceId: YOGA.id,
  type: 'group',
  sessionId: COURSE.id,
  startsAt: COURSE.startsAt,
  endsAt: COURSE.endsAt,
  status: 'confirmed',
  participant: { name: 'Anna Muster', email: 'anna@example.test', phone: '030 1234567' },
};
const BEN: Booking = {
  ...ANNA,
  id: '66f1a2b3c4d5e6f708192e02',
  participant: { name: 'Ben Beispiel', email: 'ben@example.test', phone: '+49 30 7654321' },
};
const CLARA: Booking = {
  ...ANNA,
  id: '66f1a2b3c4d5e6f708192e03',
  status: 'cancelled',
  participant: { name: 'Clara Storno', email: 'clara@example.test', phone: '030 111111' },
};
const DORA: Booking = {
  ...base,
  id: '66f1a2b3c4d5e6f708192e04',
  serviceId: HAIRCUT.id,
  type: 'single',
  sessionId: null,
  startsAt: '2030-10-15T07:00:00Z',
  endsAt: '2030-10-15T07:30:00Z',
  status: 'confirmed',
  participant: { name: 'Dora Schnitt', email: 'dora@example.test', phone: '030 222222' },
};

const RANGE = 'von=2030-10-14&bis=2030-10-20';
const listPath = (query: string) => `/api/owner/bookings?${query}`;
const ok =
  (body: unknown): Handler =>
  () =>
    json(body);

function setup(path: string, handlers: Record<string, Handler | Handler[]> = {}) {
  const { fetch, calls } = fakeFetch({
    'GET /api/auth/session': withSession,
    'GET /api/owner/calendar': ok({ calendarId: 'cal_AAAAAAAAAAAAAAAA', timeZone: TZ }),
    'GET /api/owner/services': ok([YOGA, HAIRCUT]),
    ...handlers,
  });
  const rendered = renderPortal(path, fetch);
  return { ...rendered, calls, user: userEvent.setup() };
}

const writes = (calls: Call[]): Call[] => calls.filter((call) => call.method !== 'GET');
const bookingRequests = (calls: Call[]): string[] =>
  calls.filter((c) => c.path.startsWith('/api/owner/bookings?')).map((c) => c.path);

describe('Buchungsübersicht', () => {
  it('zeigt bestätigte Buchungen beider Terminarten nach Tagen, nur mit Namen', async () => {
    const { calls } = setup(`/buchungen?${RANGE}`, {
      [`GET ${listPath('from=2030-10-14&to=2030-10-20&status=confirmed')}`]: ok([ANNA, BEN, DORA]),
    });
    const monday = await screen.findByRole('region', { name: 'Mo., 14.10.2030' });
    expect(
      within(monday).getByRole('link', { name: '18:00–19:00 Uhr · Anna Muster' }),
    ).toHaveAttribute('href', `/buchungen/${ANNA.id}`);
    expect(monday).toHaveTextContent('Yoga');
    const tuesday = screen.getByRole('region', { name: 'Di., 15.10.2030' });
    expect(tuesday).toHaveTextContent('09:00–09:30 Uhr · Dora Schnitt');
    expect(tuesday).toHaveTextContent('Haarschnitt');
    expect(screen.getByText(/3 bestätigte Buchungen/)).toBeVisible();
    // Kontaktdaten erscheinen erst in Detailansicht und Teilnehmerliste.
    expect(screen.queryByText('anna@example.test')).not.toBeInTheDocument();
    expect(bookingRequests(calls)).toEqual([
      listPath('from=2030-10-14&to=2030-10-20&status=confirmed'),
    ]);
  });

  it('blendet auf Wunsch stornierte und abgesagte Buchungen ein', async () => {
    const { user, router } = setup(`/buchungen?${RANGE}`, {
      [`GET ${listPath('from=2030-10-14&to=2030-10-20&status=confirmed')}`]: ok([ANNA]),
      [`GET ${listPath('from=2030-10-14&to=2030-10-20')}`]: ok([ANNA, CLARA]),
    });
    await screen.findByText('18:00–19:00 Uhr · Anna Muster');
    await user.click(
      screen.getByRole('checkbox', { name: 'Auch stornierte und abgesagte anzeigen' }),
    );
    const clara = await screen.findByRole('link', { name: '18:00–19:00 Uhr · Clara Storno' });
    expect(clara.closest('li')).toHaveTextContent('Storniert');
    expect(router.state.location.search).toContain('alle=1');
    expect(screen.getByText(/1 bestätigte Buchung, 1 weitere/)).toBeVisible();
  });

  it('filtert nach Angebot', async () => {
    const { user, calls } = setup(`/buchungen?${RANGE}`, {
      [`GET ${listPath('from=2030-10-14&to=2030-10-20&status=confirmed')}`]: ok([ANNA, DORA]),
      [`GET ${listPath(`from=2030-10-14&to=2030-10-20&serviceId=${HAIRCUT.id}&status=confirmed`)}`]:
        ok([DORA]),
    });
    await screen.findByText('18:00–19:00 Uhr · Anna Muster');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Angebot' }), 'Haarschnitt');
    await waitFor(() => {
      expect(screen.queryByText('18:00–19:00 Uhr · Anna Muster')).not.toBeInTheDocument();
    });
    expect(screen.getByText('09:00–09:30 Uhr · Dora Schnitt')).toBeVisible();
    expect(bookingRequests(calls).at(-1)).toContain(`serviceId=${HAIRCUT.id}`);
  });

  it('übernimmt einen eingegebenen Zeitraum und prüft ihn', async () => {
    const { user, router } = setup(`/buchungen?${RANGE}`, {
      [`GET ${listPath('from=2030-10-14&to=2030-10-20&status=confirmed')}`]: ok([]),
      [`GET ${listPath('from=2030-11-01&to=2030-11-30&status=confirmed')}`]: ok([]),
    });
    expect(await screen.findByText('Keine Buchungen in diesem Zeitraum.')).toBeVisible();
    const from = screen.getByLabelText('Von');
    const to = screen.getByLabelText('Bis');

    fireEvent.change(from, { target: { value: '2030-11-01' } });
    fireEvent.change(to, { target: { value: '2031-03-01' } });
    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Höchstens 92 Tage auf einmal.');

    fireEvent.change(to, { target: { value: '2030-11-30' } });
    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('von=2030-11-01&bis=2030-11-30');
    });
  });

  it('beginnt ohne Angaben mit heute und 31 Tagen und bietet Schnellauswahlen', async () => {
    const today = todayIn(TZ);
    const { user, calls } = setup('/buchungen', {
      [`GET ${listPath(`from=${today}&to=${addDays(today, 30)}&status=confirmed`)}`]: ok([]),
      [`GET ${listPath(`from=${today}&to=${today}&status=confirmed`)}`]: ok([]),
    });
    await screen.findByText('Keine Buchungen in diesem Zeitraum.');
    expect(screen.getByRole('button', { name: 'Nächste 31 Tage' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Heute' }));
    await waitFor(() => {
      expect(bookingRequests(calls).at(-1)).toBe(
        listPath(`from=${today}&to=${today}&status=confirmed`),
      );
    });
    expect(screen.getByLabelText('Von')).toHaveValue(today);
  });
});

describe('Buchungsdetail', () => {
  it('zeigt Teilnehmer mit Kontakt-Links, Termin und Kurs-Link', async () => {
    setup(`/buchungen/${ANNA.id}`, { [`GET /api/owner/bookings/${ANNA.id}`]: ok(ANNA) });
    expect(await screen.findByRole('heading', { name: 'Anna Muster' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'anna@example.test' })).toHaveAttribute(
      'href',
      'mailto:anna@example.test',
    );
    expect(screen.getByRole('link', { name: '030 1234567' })).toHaveAttribute(
      'href',
      'tel:0301234567',
    );
    expect(await screen.findByRole('link', { name: 'Yoga' })).toHaveAttribute(
      'href',
      `/kurstermine/${COURSE.id}`,
    );
    expect(screen.getByText('Bestätigt')).toBeVisible();
    // Kein Teilnehmername im Fenstertitel.
    expect(document.title).not.toContain('Anna');
  });

  it('sagt eine Buchung nach Bestätigung mit Begründung ab', async () => {
    const { user, calls } = setup(`/buchungen/${DORA.id}`, {
      [`GET /api/owner/bookings/${DORA.id}`]: ok(DORA),
      [`POST /api/owner/bookings/${DORA.id}/cancel`]: () =>
        json({
          booking: { ...DORA, status: 'cancelled_by_owner', ownerCancellationReason: 'Krank' },
          alreadyCancelled: false,
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Buchung absagen …' }));
    expect(screen.getByText(/Dora Schnitt erhält eine Absage per E-Mail/)).toBeVisible();
    await user.type(screen.getByLabelText('Begründung (optional)'), 'Krank');
    await user.click(screen.getByRole('button', { name: 'Verbindlich absagen' }));

    expect(
      await screen.findByText('Buchung abgesagt. Der Teilnehmer wird per E-Mail informiert.'),
    ).toBeVisible();
    expect(screen.getByText('Abgesagt')).toBeVisible();
    expect(screen.getByText('Krank')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Buchung absagen …' })).not.toBeInTheDocument();
    const [post] = writes(calls);
    expect(post?.body).toEqual({ confirm: true, reason: 'Krank' });
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('meldet abgelehnte Absagen verständlich', async () => {
    const { user } = setup(`/buchungen/${DORA.id}`, {
      [`GET /api/owner/bookings/${DORA.id}`]: ok(DORA),
      [`POST /api/owner/bookings/${DORA.id}/cancel`]: () =>
        json(
          {
            statusCode: 409,
            code: 'not_cancellable',
            message: 'Die Buchung ist nicht mehr aktiv und kann nicht abgesagt werden',
          },
          409,
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Buchung absagen …' }));
    await user.click(screen.getByRole('button', { name: 'Verbindlich absagen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nicht mehr aktiv');
  });

  it('bietet bei inaktiven Buchungen keine Absage an und verlinkt Umbuchungen', async () => {
    const rebooked: Booking = {
      ...ANNA,
      status: 'rebooked',
      rebookedToBookingId: BEN.id,
    };
    setup(`/buchungen/${ANNA.id}`, { [`GET /api/owner/bookings/${ANNA.id}`]: ok(rebooked) });
    expect(await screen.findByText('Umgebucht')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Neue Buchung ansehen' })).toHaveAttribute(
      'href',
      `/buchungen/${BEN.id}`,
    );
    expect(screen.queryByRole('button', { name: 'Buchung absagen …' })).not.toBeInTheDocument();
  });

  it('meldet unbekannte Buchungen', async () => {
    setup('/buchungen/66f1a2b3c4d5e6f708192eff', {
      'GET /api/owner/bookings/66f1a2b3c4d5e6f708192eff': () =>
        json({ statusCode: 404, message: 'Buchung nicht gefunden' }, 404),
    });
    expect(await screen.findByRole('heading', { name: 'Buchung nicht gefunden' })).toBeVisible();
  });
});

describe('Teilnehmerliste eines Kurstermins', () => {
  it('zeigt bestätigte Teilnehmer mit Kontakt und die Historie eingeklappt', async () => {
    setup(`/kurstermine/${COURSE.id}`, {
      [`GET /api/owner/sessions/${COURSE.id}`]: ok(COURSE),
      [`GET /api/owner/sessions/${COURSE.id}/participants`]: ok({
        session: COURSE,
        bookings: [ANNA, CLARA, BEN],
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Teilnehmer (2)' })).toBeVisible();
    const list = screen.getByRole('list', { name: 'Bestätigte Teilnehmer' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByRole('link')[0]?.textContent)).toEqual([
      'Anna Muster',
      'Ben Beispiel',
    ]);
    expect(within(list).getByRole('link', { name: 'Anna Muster' })).toHaveAttribute(
      'href',
      `/buchungen/${ANNA.id}`,
    );
    expect(within(list).getByRole('link', { name: '+49 30 7654321' })).toHaveAttribute(
      'href',
      'tel:+49307654321',
    );
    const history = screen.getByText('Storniert, umgebucht oder abgesagt (1)');
    expect(history.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('list', { name: 'Frühere Buchungen', hidden: true })).toHaveTextContent(
      'Clara Storno',
    );
  });
});
