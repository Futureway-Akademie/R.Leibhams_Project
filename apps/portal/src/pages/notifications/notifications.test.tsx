import type { FailedNotification, FailedNotificationsResponse } from '@fw-booking/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../api/client.js';
import { SESSION, fakeFetch, json, renderPortal, withSession } from '../../test-utils.js';
import type { Call, Handler } from '../../test-utils.js';

const TZ = 'Europe/Berlin';
const PATH = '/api/owner/notifications/failed';

const CONFIRMATION: FailedNotification = {
  id: '66f1a2b3c4d5e6f708192f01',
  type: 'booking_confirmation',
  category: 'smtp_unavailable',
  failedAt: '2030-10-14T08:30:00Z',
  attempts: 6,
  booking: {
    id: '66f1a2b3c4d5e6f708192e01',
    serviceTitle: 'Yoga',
    startsAt: '2030-10-20T16:00:00Z',
    status: 'confirmed',
    participant: { name: 'Anna Muster', email: 'anna@example.test', phone: '030 1234567' },
  },
};
const REJECTED: FailedNotification = {
  ...CONFIRMATION,
  id: '66f1a2b3c4d5e6f708192f02',
  type: 'booking_reminder',
  category: 'recipient_rejected',
  failedAt: '2030-10-13T07:00:00Z',
  attempts: 1,
};
const ORPHAN: FailedNotification = {
  ...CONFIRMATION,
  id: '66f1a2b3c4d5e6f708192f03',
  type: 'owner_cancellation',
  category: 'booking_missing',
  booking: null,
};

const response =
  (
    notifications: FailedNotification[],
    extra: Partial<FailedNotificationsResponse> = {},
  ): Handler =>
  () =>
    json({ notifications, total: notifications.length, retryingCount: 0, ...extra });

function setup(path: string, handlers: Record<string, Handler | Handler[]> = {}) {
  const { fetch, calls } = fakeFetch({
    'GET /api/auth/session': withSession,
    'GET /api/owner/calendar': () => json({ calendarId: 'cal_AAAAAAAAAAAAAAAA', timeZone: TZ }),
    ...handlers,
  });
  const rendered = renderPortal(path, fetch);
  return { ...rendered, calls, user: userEvent.setup() };
}

const writes = (calls: Call[]): Call[] => calls.filter((call) => call.method !== 'GET');

describe('Fehlgeschlagene Benachrichtigungen', () => {
  it('zeigt Typ, Zeitpunkt, Ursache, Versuche und betroffene Buchung', async () => {
    setup('/benachrichtigungen', {
      [`GET ${PATH}`]: response([CONFIRMATION, REJECTED, ORPHAN], { retryingCount: 2 }),
    });
    const list = await screen.findByRole('list', { name: 'Fehlgeschlagene Benachrichtigungen' });
    const [first, second, third] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Buchungsbestätigung');
    expect(first).toHaveTextContent('Fehlgeschlagen am Mo., 14. Okt. 2030, 10:30 Uhr');
    expect(first).toHaveTextContent('6 Versuche');
    expect(first).toHaveTextContent('Der Mailserver war nicht erreichbar.');
    expect(first).toHaveTextContent('Yoga am So., 20. Okt. 2030, 18:00 Uhr · Bestätigt');
    expect(within(first as HTMLElement).getByRole('link', { name: 'Anna Muster' })).toHaveAttribute(
      'href',
      `/buchungen/${CONFIRMATION.booking?.id ?? ''}`,
    );
    expect(second).toHaveTextContent('Erinnerung');
    expect(second).toHaveTextContent('1 Versuch');
    expect(third).toHaveTextContent('Die zugehörige Buchung existiert nicht mehr.');
    expect(screen.getByText('2 E-Mails werden gerade automatisch erneut versucht.')).toBeVisible();
  });

  it('bietet „Erneut senden“ nur bei sinnvollen Ursachen an', async () => {
    setup('/benachrichtigungen', { [`GET ${PATH}`]: response([CONFIRMATION, REJECTED, ORPHAN]) });
    const items = within(
      await screen.findByRole('list', { name: 'Fehlgeschlagene Benachrichtigungen' }),
    ).getAllByRole('listitem');
    expect(
      within(items[0] as HTMLElement).getByRole('button', { name: /erneut senden/ }),
    ).toBeVisible();
    for (const item of items.slice(1)) {
      expect(within(item).queryByRole('button', { name: /erneut senden/ })).not.toBeInTheDocument();
      expect(within(item).getByRole('button', { name: /ausblenden/ })).toBeVisible();
    }
    // Bei abgelehnter Adresse: Hinweis auf einen anderen Weg mit Telefon-Link.
    expect(
      within(items[1] as HTMLElement).getByRole('link', { name: '030 1234567' }),
    ).toHaveAttribute('href', 'tel:0301234567');
  });

  it('reiht eine Benachrichtigung erneut ein und lädt die Liste neu', async () => {
    const { user, calls } = setup('/benachrichtigungen', {
      [`GET ${PATH}`]: [response([CONFIRMATION]), response([])],
      [`POST ${PATH}/${CONFIRMATION.id}/retry`]: () =>
        json({ id: CONFIRMATION.id, status: 'pending', alreadyDone: false }),
    });
    await user.click(
      await screen.findByRole('button', { name: /Buchungsbestätigung .* erneut senden/ }),
    );
    expect(await screen.findByText('Buchungsbestätigung wird erneut versendet.')).toBeVisible();
    expect(
      await screen.findByText('Keine offenen fehlgeschlagenen Benachrichtigungen.'),
    ).toBeVisible();
    const [post] = writes(calls);
    expect(post?.path).toBe(`${PATH}/${CONFIRMATION.id}/retry`);
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('blendet erst nach Rückfrage aus', async () => {
    const { user, calls } = setup('/benachrichtigungen', {
      [`GET ${PATH}`]: [response([REJECTED]), response([])],
      [`POST ${PATH}/${REJECTED.id}/dismiss`]: () =>
        json({ id: REJECTED.id, status: 'failed', alreadyDone: false }),
    });
    await user.click(await screen.findByRole('button', { name: /Erinnerung .* ausblenden$/ }));
    expect(screen.getByText(/Wirklich ausblenden\?/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(writes(calls)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Erinnerung .* ausblenden$/ }));
    await user.click(screen.getByRole('button', { name: /endgültig ausblenden/ }));
    expect(await screen.findByText('Erinnerung ausgeblendet.')).toBeVisible();
    expect(writes(calls)[0]?.path).toBe(`${PATH}/${REJECTED.id}/dismiss`);
  });

  it('meldet Fehler einer Aktion am Eintrag', async () => {
    const { user } = setup('/benachrichtigungen', {
      [`GET ${PATH}`]: response([CONFIRMATION]),
      [`POST ${PATH}/${CONFIRMATION.id}/retry`]: () =>
        json(
          { statusCode: 409, message: 'Die Benachrichtigung ist nicht mehr fehlgeschlagen' },
          409,
        ),
    });
    await user.click(await screen.findByRole('button', { name: /erneut senden/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Benachrichtigung ist nicht mehr fehlgeschlagen',
    );
  });

  it('filtert nach Art und merkt sich die Auswahl in der Adresse', async () => {
    const { user, router, calls } = setup('/benachrichtigungen', {
      [`GET ${PATH}`]: response([CONFIRMATION, REJECTED]),
      [`GET ${PATH}?type=booking_reminder`]: response([REJECTED]),
    });
    await screen.findByRole('list', { name: 'Fehlgeschlagene Benachrichtigungen' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Art' }), 'Erinnerung');
    await waitFor(() => {
      expect(calls.some((c) => c.path === `${PATH}?type=booking_reminder`)).toBe(true);
    });
    expect(router.state.location.search).toBe('?typ=booking_reminder');
  });

  it('zeigt einen Leerzustand und den Hinweis auf gekürzte Listen', async () => {
    setup('/benachrichtigungen', { [`GET ${PATH}`]: response([]) });
    expect(
      await screen.findByText('Keine offenen fehlgeschlagenen Benachrichtigungen.'),
    ).toBeVisible();
  });

  it('nennt die Gesamtzahl, wenn nur die neuesten geliefert werden', async () => {
    setup('/benachrichtigungen', { [`GET ${PATH}`]: response([CONFIRMATION], { total: 250 }) });
    expect(await screen.findByText('Angezeigt werden die neuesten 1 von 250.')).toBeVisible();
  });
});

describe('Hinweise außerhalb der Seite', () => {
  it('zeigt die Zahl in der Navigation und einen Hinweis auf der Übersicht', async () => {
    setup('/', { [`GET ${PATH}`]: response([CONFIRMATION, REJECTED]) });
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    expect(
      await within(nav).findByRole('link', { name: 'Benachrichtigungen (2 fehlgeschlagen)' }),
    ).toBeVisible();
    expect(
      screen.getByText(/2 E-Mails an Teilnehmer konnten nicht zugestellt werden/),
    ).toBeVisible();
  });

  it('zeigt ohne Fehlschläge keine Zahl', async () => {
    setup('/');
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    await screen.findByRole('heading', { name: 'Übersicht' });
    expect(within(nav).getByRole('link', { name: 'Benachrichtigungen' })).toBeVisible();
    expect(screen.queryByText(/nicht zugestellt/)).not.toBeInTheDocument();
  });
});
