import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER } from './api/client.js';
import { SESSION_QUERY_KEY } from './auth/session.js';
import { SESSION, fakeFetch, json, noSession, renderPortal, withSession } from './test-utils.js';

const loginOk = () => json(SESSION);

async function fillLogin(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-Mail-Adresse'), email);
  if (password) await user.type(screen.getByLabelText('Passwort'), password);
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));
}

describe('Portal: Anmeldung und geschützte Seiten', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('leitet geschützte Seiten ohne Sitzung zum Login', async () => {
    const { fetch } = fakeFetch({ 'GET /api/auth/session': noSession });
    const { router } = renderPortal('/angebote?x=1', fetch);

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/angebote?x=1' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('meldet an und kehrt zur ursprünglich aufgerufenen Seite zurück', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': loginOk,
    });
    const { router } = renderPortal('/kurstermine', fetch);

    await fillLogin(' owner@example.test ', 'ein-langes-passwort');

    expect(await screen.findByRole('heading', { name: 'Kurstermine' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/kurstermine');
    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    const loginCall = calls.find((c) => c.path === '/api/auth/login');
    expect(loginCall?.body).toEqual({
      email: 'owner@example.test',
      password: 'ein-langes-passwort',
    });
    expect(loginCall?.headers.has(CSRF_HEADER)).toBe(false);
  });

  it('hält Sitzungs- und CSRF-Token nicht im Browser-Speicher', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': loginOk,
    });
    renderPortal('/', fetch);
    await fillLogin('owner@example.test', 'ein-langes-passwort');
    await screen.findByRole('heading', { name: 'Übersicht' });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(window.location.href).not.toContain(SESSION.csrfToken);
  });

  it('zeigt bei falschen Zugangsdaten eine Meldung und leert das Passwort', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': () =>
        json({ statusCode: 401, message: 'E-Mail oder Passwort ist falsch' }, 401),
    });
    const { router } = renderPortal('/login', fetch);

    await fillLogin('owner@example.test', 'falsch');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-Mail-Adresse oder Passwort ist falsch.',
    );
    expect(screen.getByLabelText('Passwort')).toHaveValue('');
    expect(screen.getByLabelText('Passwort')).toHaveFocus();
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveValue('owner@example.test');
    expect(router.state.location.pathname).toBe('/login');
  });

  it.each([
    [429, 'Zu viele fehlgeschlagene Anmeldeversuche'],
    [500, 'Die Anmeldung ist fehlgeschlagen'],
  ])('meldet Status %i verständlich', async (status, text) => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': () => json({ statusCode: status, message: 'x' }, status),
    });
    renderPortal('/login', fetch);
    await fillLogin('owner@example.test', 'ein-langes-passwort');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('meldet einen nicht erreichbaren Server beim Login', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    renderPortal('/login', fetch);
    await fillLogin('owner@example.test', 'ein-langes-passwort');
    expect(await screen.findByRole('alert')).toHaveTextContent('Der Server ist nicht erreichbar');
  });

  it('prüft Eingaben vor dem Absenden', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/auth/session': noSession });
    renderPortal('/login', fetch);

    await fillLogin('keine-adresse', '');

    expect(
      await screen.findByText('Bitte eine gültige E-Mail-Adresse eingeben.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bitte das Passwort eingeben.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveFocus();
    expect(calls.some((c) => c.path === '/api/auth/login')).toBe(false);
  });

  it('sendet bei Doppelklick nur eine Anmeldung', async () => {
    let release: (() => void) | undefined;
    const { fetch, calls } = fakeFetch({
      'GET /api/auth/session': noSession,
      'POST /api/auth/login': () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(SESSION));
          };
        }),
    });
    renderPortal('/login', fetch);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-Mail-Adresse'), 'owner@example.test');
    await user.type(screen.getByLabelText('Passwort'), 'ein-langes-passwort');
    const button = screen.getByRole('button', { name: 'Anmelden' });
    await user.dblClick(button);

    expect(screen.getByRole('button', { name: 'Anmelden …' })).toBeDisabled();
    release?.();
    await screen.findByRole('heading', { name: 'Übersicht' });
    expect(calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(1);
  });

  it('öffnet mit bestehender Sitzung direkt das Portal und überspringt den Login', async () => {
    const { fetch } = fakeFetch({ 'GET /api/auth/session': withSession });
    const { router } = renderPortal('/login', fetch);

    expect(await screen.findByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  });

  it('meldet ab, sendet das CSRF-Token und entfernt die Sitzung aus dem Speicher', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/auth/session': withSession,
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const { portal, router } = renderPortal('/buchungen', fetch);
    portal.queryClient.setQueryData(['owner', 'beispiel'], { teilnehmer: 'Max' });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    const logoutCall = calls.find((c) => c.path === '/api/auth/logout');
    expect(logoutCall?.headers.get(CSRF_HEADER)).toBe(SESSION.csrfToken);
    expect(portal.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
    expect(portal.queryClient.getQueryData(['owner', 'beispiel'])).toBeUndefined();
  });

  it('wiederholt das Abmelden einmal mit neuem CSRF-Token nach 403', async () => {
    const renewed = { ...SESSION, csrfToken: 'neues-token' };
    const { fetch, calls } = fakeFetch({
      'GET /api/auth/session': [withSession, () => json(renewed)],
      'POST /api/auth/logout': [
        () => json({ statusCode: 403, message: 'CSRF-Token fehlt oder ist ungültig' }, 403),
        () => new Response(null, { status: 204 }),
      ],
    });
    renderPortal('/', fetch);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    const logouts = calls.filter((c) => c.path === '/api/auth/logout');
    expect(logouts.map((c) => c.headers.get(CSRF_HEADER))).toEqual([
      SESSION.csrfToken,
      'neues-token',
    ]);
  });

  it('bleibt angemeldet und meldet einen Fehler, wenn das Abmelden den Server nicht erreicht', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': withSession,
      'POST /api/auth/logout': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    renderPortal('/', fetch);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Abmelden fehlgeschlagen');
    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
  });

  it('leitet zum Login, sobald eine Owner-Anfrage mit 401 endet (abgelaufene Sitzung)', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': withSession,
      'GET /api/owner/services': noSession,
    });
    const { portal, router } = renderPortal('/angebote', fetch);
    await screen.findByRole('heading', { name: 'Angebote' });

    await portal.queryClient
      .query({
        queryKey: ['owner', 'services'],
        queryFn: () => portal.api.get('/api/owner/services'),
      })
      .catch(() => undefined);

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: '/angebote' });
  });

  it('zeigt bei nicht erreichbarem Server einen erneuten Versuch statt des Logins', async () => {
    const { fetch } = fakeFetch({
      'GET /api/auth/session': [
        () => Promise.reject(new TypeError('Failed to fetch')),
        () => Promise.reject(new TypeError('Failed to fetch')),
        withSession,
      ],
    });
    renderPortal('/', fetch);

    // Ein automatischer Wiederholversuch nach etwa einer Sekunde, dann der Hinweis.
    expect(
      await screen.findByText('Der Server ist gerade nicht erreichbar.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
  });

  it('zeigt für unbekannte Pfade eine eigene Seite innerhalb des Portals', async () => {
    const { fetch } = fakeFetch({ 'GET /api/auth/session': withSession });
    renderPortal('/gibt-es-nicht', fetch);
    expect(
      await screen.findByRole('heading', { name: 'Seite nicht gefunden' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe('Seite nicht gefunden – Buchungsverwaltung');
    });
  });
});
