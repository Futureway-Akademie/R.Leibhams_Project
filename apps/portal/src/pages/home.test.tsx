import type { Booking, Service, Session } from '@fw-booking/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { addDays, todayIn } from '../availability/time.js';
import { fakeFetch, json, renderPortal, withSession } from '../test-utils.js';
import { REFRESH_MS } from './HomePage.js';
import type { Call, Handler } from '../test-utils.js';

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
  bookedCount: 7,
  status: 'scheduled',
  location: 'Raum 2',
  cancellationReason: null,
};
const FULL_COURSE: Session = {
  ...COURSE,
  id: '66f1a2b3c4d5e6f708192d02',
  startsAt: '2030-10-14T18:00:00Z',
  endsAt: '2030-10-14T19:00:00Z',
  bookedCount: 12,
  location: null,
};
const CANCELLED_COURSE: Session = {
  ...COURSE,
  id: '66f1a2b3c4d5e6f708192d03',
  startsAt: '2030-10-14T10:00:00Z',
  endsAt: '2030-10-14T11:00:00Z',
  bookedCount: 0,
  status: 'cancelled',
  location: null,
};

const base = {
  timeZone: TZ,
  rebookedToBookingId: null,
  ownerCancellationReason: null,
  createdAt: '2030-10-01T07:15:00Z',
};
const DORA: Booking = {
  ...base,
  id: '66f1a2b3c4d5e6f708192e04',
  serviceId: HAIRCUT.id,
  type: 'single',
  sessionId: null,
  startsAt: '2030-10-14T07:00:00Z',
  endsAt: '2030-10-14T07:30:00Z',
  status: 'confirmed',
  participant: { name: 'Dora Schnitt', email: 'dora@example.test', phone: '030 222222' },
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

const sessionsPath = (from: string, to: string) =>
  `/api/owner/sessions?from=${from}&to=${to}&includeCancelled=true`;
const bookingsPath = (from: string, to: string) =>
  `/api/owner/bookings?from=${from}&to=${to}&status=confirmed`;

const ok =
  (body: unknown): Handler =>
  () =>
    json(body);
const serverError: Handler = () => json({ statusCode: 503, message: 'Service Unavailable' }, 503);

/** Antworten für einen Tag (Kurstermine und Buchungen). */
function day(date: string, sessions: Session[], bookings: Booking[]): Record<string, Handler> {
  return {
    [`GET ${sessionsPath(date, date)}`]: ok(sessions),
    [`GET ${bookingsPath(date, date)}`]: ok(bookings),
  };
}

/** Antworten für die Suche „Als Nächstes“ ab `from` (31 Tage). */
function nextUp(from: string, sessions: Session[], bookings: Booking[]): Record<string, Handler> {
  const to = addDays(from, 30);
  return {
    [`GET ${sessionsPath(from, to)}`]: ok(sessions),
    [`GET ${bookingsPath(from, to)}`]: ok(bookings),
  };
}

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

const dataRequests = (calls: Call[]): string[] =>
  calls
    .map((call) => call.path)
    .filter((path) => /^\/api\/owner\/(sessions|bookings)\?/.test(path));

describe('Startansicht', () => {
  it('zeigt die Termine des Tages mit Belegung, ohne Teilnehmernamen', async () => {
    const { calls } = setup('/?tag=2030-10-14', {
      ...day('2030-10-14', [COURSE, FULL_COURSE, CANCELLED_COURSE], [DORA, ANNA]),
    });
    const list = await screen.findByRole('list', { name: 'Termine' });
    expect(screen.getByRole('heading', { level: 2, name: 'Mo., 14.10.2030' })).toBeVisible();

    const entries = within(list).getAllByRole('listitem');
    expect(entries.map((entry) => entry.querySelector('.item-title')?.textContent)).toEqual([
      '09:00–09:30 Uhr · Haarschnitt',
      '12:00–13:00 Uhr · Yoga',
      '18:00–19:00 Uhr · Yoga',
      '20:00–21:00 Uhr · Yoga',
    ]);
    const [single, cancelled, course, full] = entries as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(single).getByRole('link')).toHaveAttribute('href', `/buchungen/${DORA.id}`);
    expect(single).toHaveTextContent('Einzeltermin');
    expect(within(course).getByRole('link')).toHaveAttribute('href', `/kurstermine/${COURSE.id}`);
    expect(course).toHaveTextContent('7 / 12 Plätze');
    expect(course).toHaveTextContent('Raum 2');
    expect(full).toHaveTextContent('12 / 12 Plätze · ausgebucht');
    expect(cancelled).toHaveTextContent('Abgesagt');
    expect(cancelled).not.toHaveTextContent('Plätze');

    // Namen und Kontaktdaten erst in der Detailansicht.
    expect(
      screen.queryByText(/Dora Schnitt|Anna Muster|dora@example\.test/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^Stand: \d{2}:\d{2} Uhr$/)).toBeVisible();
    // Künftiger Tag mit Terminen: kein Block „Als Nächstes“.
    expect(screen.queryByRole('heading', { name: 'Als Nächstes' })).not.toBeInTheDocument();
    expect(dataRequests(calls)).toEqual([
      sessionsPath('2030-10-14', '2030-10-14'),
      bookingsPath('2030-10-14', '2030-10-14'),
    ]);
  });

  it('zeigt die Teilnehmernamen in der Detailansicht', async () => {
    const { user } = setup('/?tag=2030-10-14', {
      ...day('2030-10-14', [], [DORA]),
      [`GET /api/owner/bookings/${DORA.id}`]: ok(DORA),
    });
    await user.click(await screen.findByRole('link', { name: '09:00–09:30 Uhr · Haarschnitt' }));
    expect(await screen.findByText('Dora Schnitt')).toBeVisible();
    expect(screen.getByRole('link', { name: 'dora@example.test' })).toBeVisible();
  });

  it('blättert tageweise und kehrt zu heute zurück', async () => {
    const today = todayIn(TZ);
    const { user, router } = setup('/?tag=2030-10-14', {
      ...day('2030-10-14', [COURSE], []),
      ...day(
        '2030-10-15',
        [],
        [{ ...DORA, startsAt: '2030-10-15T07:00:00Z', endsAt: '2030-10-15T07:30:00Z' }],
      ),
      ...day('2030-10-13', [], []),
      ...nextUp('2030-10-14', [COURSE], []),
      ...day(today, [], []),
      ...nextUp(today, [], []),
    });
    await screen.findByRole('link', { name: '18:00–19:00 Uhr · Yoga' });

    await user.click(screen.getByRole('button', { name: 'Nächster Tag' }));
    expect(await screen.findByRole('heading', { name: 'Di., 15.10.2030' })).toBeVisible();
    expect(
      await screen.findByRole('link', { name: '09:00–09:30 Uhr · Haarschnitt' }),
    ).toBeVisible();
    expect(router.state.location.search).toBe('?tag=2030-10-15');

    await user.click(screen.getByRole('button', { name: 'Vorheriger Tag' }));
    await user.click(screen.getByRole('button', { name: 'Vorheriger Tag' }));
    expect(await screen.findByRole('heading', { name: 'So., 13.10.2030' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Heute' }));
    expect(await screen.findByRole('heading', { name: /^Heute, / })).toBeVisible();
    expect(router.state.location.search).toBe('');
    expect(screen.queryByRole('button', { name: 'Heute' })).not.toBeInTheDocument();
  });

  it('zeigt bei einem leeren Tag den nächsten Termin und springt zu dessen Tag', async () => {
    const { user, router } = setup('/?tag=2030-10-13', {
      ...day('2030-10-13', [], []),
      ...nextUp('2030-10-14', [COURSE, FULL_COURSE], [DORA]),
      ...day('2030-10-14', [COURSE, FULL_COURSE], [DORA]),
    });
    expect(await screen.findByText('Keine Termine an diesem Tag.')).toBeVisible();
    const next = await screen.findByRole('region', { name: 'Als Nächstes' });
    expect(
      await within(next).findByRole('link', {
        name: 'Mo., 14.10.2030, 09:00–09:30 Uhr · Haarschnitt',
      }),
    ).toHaveAttribute('href', `/buchungen/${DORA.id}`);
    expect(within(next).getAllByRole('listitem')).toHaveLength(1);

    await user.click(within(next).getByRole('button', { name: 'Tag anzeigen (Mo., 14.10.2030)' }));
    expect(router.state.location.search).toBe('?tag=2030-10-14');
    expect(await screen.findByRole('list', { name: 'Termine' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Als Nächstes' })).not.toBeInTheDocument();
  });

  it('nennt es, wenn in den nächsten 31 Tagen kein Termin geplant ist', async () => {
    setup('/?tag=2030-10-13', {
      ...day('2030-10-13', [CANCELLED_COURSE], []),
      ...nextUp('2030-10-14', [CANCELLED_COURSE], []),
    });
    expect(
      await screen.findByText('In den nächsten 31 Tagen ist kein Termin geplant.'),
    ).toBeVisible();
  });

  it('markiert vergangene Termine und sucht den nächsten ab heute', async () => {
    const today = todayIn(TZ);
    const past: Session = {
      ...COURSE,
      startsAt: '2020-01-06T16:00:00Z',
      endsAt: '2020-01-06T17:00:00Z',
    };
    const { calls } = setup('/?tag=2020-01-06', {
      ...day('2020-01-06', [past], []),
      ...nextUp(today, [], []),
    });
    const list = await screen.findByRole('list', { name: 'Termine' });
    expect(within(list).getByRole('listitem')).toHaveTextContent('Vorbei');
    expect(within(list).getByRole('listitem')).toHaveClass('item-past');
    expect(await screen.findByRole('region', { name: 'Als Nächstes' })).toBeVisible();
    await waitFor(() => {
      expect(dataRequests(calls)).toContain(sessionsPath(today, addDays(today, 30)));
    });
  });

  it('beginnt ohne Angabe mit heute', async () => {
    const today = todayIn(TZ);
    const { calls } = setup('/', { ...day(today, [], []), ...nextUp(today, [], []) });
    expect(await screen.findByRole('heading', { level: 2, name: /^Heute, / })).toBeVisible();
    expect(dataRequests(calls).slice(0, 2)).toEqual([
      sessionsPath(today, today),
      bookingsPath(today, today),
    ]);
  });

  it('aktualisiert per Knopf und behält bei einem Fehler den letzten Stand', async () => {
    const { user, calls } = setup('/?tag=2030-10-14', {
      [`GET ${sessionsPath('2030-10-14', '2030-10-14')}`]: [
        ok([COURSE]),
        ok([{ ...COURSE, bookedCount: 8 }]),
        serverError,
      ],
      [`GET ${bookingsPath('2030-10-14', '2030-10-14')}`]: ok([]),
    });
    expect(await screen.findByText('7 / 12 Plätze')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    expect(await screen.findByText('8 / 12 Plätze')).toBeVisible();
    expect(dataRequests(calls)).toHaveLength(4);

    await user.click(await screen.findByRole('button', { name: 'Aktualisieren' }));
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent(
      /^Aktualisieren fehlgeschlagen\. Angezeigt wird der Stand von \d{2}:\d{2} Uhr\.$/,
    );
    expect(screen.getByText('8 / 12 Plätze')).toBeVisible();
  });

  it('aktualisiert bei geöffneter App alle 5 Minuten von selbst', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = setup('/?tag=2030-10-14', {
        [`GET ${sessionsPath('2030-10-14', '2030-10-14')}`]: [
          ok([COURSE]),
          ok([{ ...COURSE, bookedCount: 9 }]),
        ],
        [`GET ${bookingsPath('2030-10-14', '2030-10-14')}`]: ok([]),
      });
      expect(await screen.findByText('7 / 12 Plätze')).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS);
      });
      expect(await screen.findByText('9 / 12 Plätze')).toBeVisible();
      expect(dataRequests(calls)).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('meldet, wenn die Termine nicht geladen werden können', async () => {
    const { user } = setup('/?tag=2030-10-14', {
      [`GET ${sessionsPath('2030-10-14', '2030-10-14')}`]: [serverError, serverError, ok([COURSE])],
      [`GET ${bookingsPath('2030-10-14', '2030-10-14')}`]: ok([]),
    });
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Die Termine konnten nicht geladen werden.');
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('7 / 12 Plätze')).toBeVisible();
  });

  it('weist weiterhin auf fehlgeschlagene Benachrichtigungen hin', async () => {
    setup('/?tag=2030-10-14', {
      ...day('2030-10-14', [], []),
      ...nextUp('2030-10-15', [], []),
      'GET /api/owner/notifications/failed': ok({ notifications: [], total: 2, retryingCount: 0 }),
    });
    expect(
      await screen.findByText(/2 E-Mails an Teilnehmer konnten nicht zugestellt werden\./),
    ).toBeVisible();
  });
});
