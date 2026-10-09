import type { Service } from '@fw-booking/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../api/client.js';
import { SESSION, fakeFetch, json, renderPortal, withSession } from '../../test-utils.js';
import type { Call, Handler } from '../../test-utils.js';

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
  id: '66f1a2b3c4d5e6f708192a02',
  type: 'single',
  title: 'Haarschnitt',
  description: 'Waschen, Schneiden',
  active: true,
  durationMinutes: 45,
  bookingRules: { ...NO_RULES, changeDeadlineMinutes: 2880 },
  sortOrder: 1,
  ...META,
};
const PILATES: Service = {
  ...YOGA,
  id: '66f1a2b3c4d5e6f708192a03',
  title: 'Pilates',
  active: false,
  durationMinutes: 90,
  defaultCapacity: 8,
  sortOrder: 2,
};

const LIST = [YOGA, HAIRCUT, PILATES];
const listOf =
  (services: Service[]): Handler =>
  () =>
    json(services);

function setup(path: string, handlers: Record<string, Handler | Handler[]>) {
  const { fetch, calls } = fakeFetch({ 'GET /api/auth/session': withSession, ...handlers });
  const rendered = renderPortal(path, fetch);
  return { ...rendered, calls, user: userEvent.setup() };
}

function serviceItems(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Angebote in Anzeigereihenfolge' })).getAllByRole(
    'listitem',
  );
}

function writes(calls: Call[]): Call[] {
  return calls.filter((call) => call.method !== 'GET');
}

describe('Angebotsliste', () => {
  it('zeigt Angebote in Reihenfolge mit Terminart, Dauer, Plätzen und Status', async () => {
    setup('/angebote', { 'GET /api/owner/services': listOf(LIST) });

    const list = await screen.findByRole('list', { name: 'Angebote in Anzeigereihenfolge' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual([
      'Yoga',
      'Haarschnitt',
      'Pilates',
    ]);
    expect(items[0]).toHaveTextContent('Gruppenkurs · 1 Std. · 12 Plätze');
    expect(items[1]).toHaveTextContent('Einzeltermin · 45 Min.');
    expect(items[1]).not.toHaveTextContent('Plätze');
    expect(items[2]).toHaveTextContent('Inaktiv');
    expect(within(items[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      `/angebote/${YOGA.id}`,
    );
  });

  it('filtert nach Status und merkt sich den Filter in der Adresse', async () => {
    const { user, router } = setup('/angebote', { 'GET /api/owner/services': listOf(LIST) });

    await user.click(await screen.findByRole('radio', { name: 'Inaktiv' }));
    expect(router.state.location.search).toBe('?status=inaktiv');
    expect(serviceItems()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Pilates' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Aktiv' }));
    expect(screen.queryByRole('link', { name: 'Pilates' })).not.toBeInTheDocument();
    expect(serviceItems()).toHaveLength(2);
  });

  it('zeigt einen Leerzustand ohne Angebote', async () => {
    setup('/angebote', { 'GET /api/owner/services': listOf([]) });
    expect(await screen.findByText('Noch keine Angebote angelegt.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neues Angebot' })).toHaveAttribute(
      'href',
      '/angebote/neu',
    );
  });

  it('zeigt einen Fehler mit erneutem Versuch', async () => {
    const { user } = setup('/angebote', {
      'GET /api/owner/services': [
        () => json({ statusCode: 500, message: 'x' }, 500),
        () => json({ statusCode: 500, message: 'x' }, 500),
        listOf(LIST),
      ],
    });
    expect(
      await screen.findByText('Die Angebote konnten nicht geladen werden.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('link', { name: 'Yoga' })).toBeInTheDocument();
  });

  it('verschiebt ein Angebot und sendet die vollständige Reihenfolge mit CSRF-Token', async () => {
    const reordered = [HAIRCUT, YOGA, PILATES];
    const { user, calls } = setup('/angebote', {
      'GET /api/owner/services': listOf(LIST),
      'PUT /api/owner/services/order': listOf(reordered),
    });

    const up = await screen.findByRole('button', { name: '„Haarschnitt“ nach oben verschieben' });
    expect(screen.getByRole('button', { name: '„Yoga“ nach oben verschieben' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '„Pilates“ nach unten verschieben' })).toBeDisabled();
    await user.click(up);

    await waitFor(() => {
      expect(
        screen.getAllByRole('link', { name: /Yoga|Haarschnitt|Pilates/ })[0],
      ).toHaveTextContent('Haarschnitt');
    });
    const [put] = writes(calls);
    expect(put?.path).toBe('/api/owner/services/order');
    expect(put?.body).toEqual({ serviceIds: [HAIRCUT.id, YOGA.id, PILATES.id] });
    expect(put?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('verschiebt bei aktivem Filter unter den sichtbaren Angeboten', async () => {
    const { user, calls } = setup('/angebote?status=aktiv', {
      'GET /api/owner/services': listOf(LIST),
      'PUT /api/owner/services/order': listOf([HAIRCUT, YOGA, PILATES]),
    });
    await user.click(await screen.findByRole('button', { name: '„Yoga“ nach unten verschieben' }));
    await waitFor(() => {
      expect(writes(calls)[0]?.body).toEqual({ serviceIds: [HAIRCUT.id, YOGA.id, PILATES.id] });
    });
  });

  it('stellt die Reihenfolge bei einem Fehler wieder her und meldet ihn', async () => {
    const { user } = setup('/angebote', {
      'GET /api/owner/services': listOf(LIST),
      'PUT /api/owner/services/order': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await user.click(await screen.findByRole('button', { name: '„Yoga“ nach unten verschieben' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Reihenfolge wurde nicht gespeichert. Der Server ist nicht erreichbar.',
    );
    await waitFor(() => {
      expect(serviceItems()[0]).toHaveTextContent('Yoga');
    });
  });

  it('deaktiviert und aktiviert Angebote ohne zu löschen', async () => {
    const { user, calls } = setup('/angebote', {
      'GET /api/owner/services': listOf(LIST),
      [`PATCH /api/owner/services/${YOGA.id}`]: () => json({ ...YOGA, active: false }),
      [`PATCH /api/owner/services/${PILATES.id}`]: () => json({ ...PILATES, active: true }),
    });

    await user.click(await screen.findByRole('button', { name: '„Yoga“ deaktivieren' }));
    expect(await screen.findByRole('button', { name: '„Yoga“ aktivieren' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '„Pilates“ aktivieren' }));
    expect(
      await screen.findByRole('button', { name: '„Pilates“ deaktivieren' }),
    ).toBeInTheDocument();

    expect(writes(calls).map((c) => [c.method, c.body])).toEqual([
      ['PATCH', { type: 'group', active: false }],
      ['PATCH', { type: 'group', active: true }],
    ]);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('Angebot anlegen', () => {
  it('legt einen Einzeltermin ohne Kapazitätsfeld an und kehrt mit Hinweis zur Liste zurück', async () => {
    const created: Service = { ...HAIRCUT, id: '66f1a2b3c4d5e6f708192a09', title: 'Bartrasur' };
    const { user, calls, router } = setup('/angebote/neu', {
      'POST /api/owner/services': () => json(created, 201),
      'GET /api/owner/services': listOf([...LIST, created]),
    });

    expect(await screen.findByRole('radio', { name: /Einzeltermin/ })).toBeChecked();
    expect(screen.queryByLabelText('Plätze je Kurstermin')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Titel'), 'Bartrasur');
    await user.clear(screen.getByLabelText('Dauer in Minuten'));
    await user.type(screen.getByLabelText('Dauer in Minuten'), '20');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Angebot „Bartrasur“ angelegt.');
    expect(router.state.location.pathname).toBe('/angebote');
    const [post] = writes(calls);
    expect(post?.body).toEqual({
      type: 'single',
      title: 'Bartrasur',
      description: null,
      active: true,
      durationMinutes: 20,
      bookingRules: NO_RULES,
    });
    expect(post?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
  });

  it('zeigt bei Gruppenkursen das Kapazitätsfeld und sendet es mit', async () => {
    const { user, calls } = setup('/angebote/neu', {
      'POST /api/owner/services': () => json({ ...YOGA, id: '66f1a2b3c4d5e6f708192a10' }, 201),
      'GET /api/owner/services': listOf(LIST),
    });

    await user.click(await screen.findByRole('radio', { name: /Gruppenkurs/ }));
    const capacity = screen.getByLabelText('Plätze je Kurstermin');
    expect(capacity).toHaveValue(10);
    expect(screen.getByText(/Dauer eines Kurstermins/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Titel'), 'Rückenfit');
    await user.clear(capacity);
    await user.type(capacity, '6');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));

    await waitFor(() => {
      expect(writes(calls)[0]?.body).toMatchObject({
        type: 'group',
        title: 'Rückenfit',
        defaultCapacity: 6,
      });
    });
  });

  it('prüft Eingaben vor dem Absenden und fokussiert das erste fehlerhafte Feld', async () => {
    const { user, calls } = setup('/angebote/neu', {});
    await user.click(await screen.findByRole('radio', { name: /Gruppenkurs/ }));
    await user.clear(screen.getByLabelText('Dauer in Minuten'));
    await user.type(screen.getByLabelText('Dauer in Minuten'), '7');
    await user.clear(screen.getByLabelText('Plätze je Kurstermin'));
    await user.type(screen.getByLabelText('Plätze je Kurstermin'), '1');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));

    expect(screen.getByText('Bitte einen Titel mit höchstens 120 Zeichen eingeben.')).toBeVisible();
    expect(screen.getByText(/5 bis 480 Minuten in 5-Minuten-Schritten/)).toBeVisible();
    expect(screen.getByText('Ein Gruppenkurs braucht mindestens 2 Plätze.')).toBeVisible();
    expect(screen.getByLabelText('Titel')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => {
      expect(screen.getByLabelText('Titel')).toHaveFocus();
    });
    expect(writes(calls)).toHaveLength(0);
  });

  it('pflegt Fristen im Bereich „Erweitert“ in Stunden und Tagen', async () => {
    const { user, calls } = setup('/angebote/neu', {
      'POST /api/owner/services': () => json(HAIRCUT, 201),
      'GET /api/owner/services': listOf(LIST),
    });
    await user.type(await screen.findByLabelText('Titel'), 'Färben');
    await user.click(screen.getByText('Erweitert: Buchungsfristen'));

    const lead = screen.getByRole('group', { name: 'Mindestvorlauf' });
    await user.click(within(lead).getByRole('checkbox', { name: 'Standard der Installation' }));
    await user.type(within(lead).getByLabelText('Mindestvorlauf in Stunden'), '2,5');
    const horizon = screen.getByRole('group', { name: 'Buchungshorizont' });
    await user.click(within(horizon).getByRole('checkbox'));
    await user.type(within(horizon).getByLabelText('Buchungshorizont in Tagen'), '1000');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));

    expect(await screen.findByText('Bitte 1 bis 730 Tage eingeben.')).toBeVisible();
    expect(writes(calls)).toHaveLength(0);

    await user.clear(within(horizon).getByLabelText('Buchungshorizont in Tagen'));
    await user.type(within(horizon).getByLabelText('Buchungshorizont in Tagen'), '120');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));
    await waitFor(() => {
      expect(writes(calls)[0]?.body).toMatchObject({
        bookingRules: { minLeadMinutes: 150, horizonDays: 120, changeDeadlineMinutes: null },
      });
    });
  });

  it('zeigt Fehler der API am Feld und bleibt auf dem Formular', async () => {
    const { user, router } = setup('/angebote/neu', {
      'POST /api/owner/services': () =>
        json(
          {
            statusCode: 400,
            message: 'Ungültige Eingabe',
            issues: [{ path: 'title', message: 'Too big' }],
          },
          400,
        ),
    });
    await user.type(await screen.findByLabelText('Titel'), 'Bartrasur');
    await user.click(screen.getByRole('button', { name: 'Angebot anlegen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Angebot wurde nicht gespeichert. Bitte die Eingaben prüfen.',
    );
    expect(screen.getByLabelText('Titel')).toHaveAttribute('aria-invalid', 'true');
    expect(router.state.location.pathname).toBe('/angebote/neu');
  });
});

describe('Angebot bearbeiten', () => {
  it('zeigt die Terminart nur an und sendet nur geänderte Felder', async () => {
    const { user, calls } = setup(`/angebote/${HAIRCUT.id}`, {
      [`GET /api/owner/services/${HAIRCUT.id}`]: () => json(HAIRCUT),
      [`PATCH /api/owner/services/${HAIRCUT.id}`]: () =>
        json({ ...HAIRCUT, title: 'Herrenschnitt' }),
      'GET /api/owner/services': listOf(LIST),
    });

    expect(await screen.findByRole('heading', { name: 'Angebot bearbeiten' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Einzeltermin')).toBeInTheDocument();
    expect(screen.getByLabelText('Titel')).toHaveValue('Haarschnitt');
    expect(screen.getByLabelText('Beschreibung (optional)')).toHaveValue('Waschen, Schneiden');
    // Eigene Frist vorhanden: Bereich ist aufgeklappt, 2880 Minuten = 48 Stunden.
    expect(screen.getByLabelText('Frist für Storno und Umbuchung in Stunden')).toHaveValue('48');

    await user.clear(screen.getByLabelText('Titel'));
    await user.type(screen.getByLabelText('Titel'), 'Herrenschnitt');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Angebot „Herrenschnitt“ gespeichert.',
    );
    expect(writes(calls).map((c) => c.body)).toEqual([{ type: 'single', title: 'Herrenschnitt' }]);
  });

  it('kehrt ohne Änderungen ohne Anfrage zur Liste zurück', async () => {
    const { user, calls, router } = setup(`/angebote/${YOGA.id}`, {
      [`GET /api/owner/services/${YOGA.id}`]: () => json(YOGA),
      'GET /api/owner/services': listOf(LIST),
    });
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Keine Änderungen.');
    expect(router.state.location.pathname).toBe('/angebote');
    expect(writes(calls)).toHaveLength(0);
  });

  it('meldet unbekannte Angebote', async () => {
    setup('/angebote/66f1a2b3c4d5e6f708192aff', {
      'GET /api/owner/services/66f1a2b3c4d5e6f708192aff': () =>
        json({ statusCode: 404, message: 'Angebot nicht gefunden' }, 404),
    });
    expect(
      await screen.findByRole('heading', { name: 'Angebot nicht gefunden' }),
    ).toBeInTheDocument();
  });

  it('fragt bei ungültiger ID nicht die API', async () => {
    const { calls } = setup('/angebote/kein-angebot', {});
    expect(
      await screen.findByRole('heading', { name: 'Angebot nicht gefunden' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/owner/services'))).toBe(false);
  });
});
