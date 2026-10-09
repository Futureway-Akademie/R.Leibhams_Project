import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useLogout, useSession } from '../auth/hooks.js';
import { useFailedNotifications } from '../notifications/queries.js';
import { NAV_ITEMS, NOTIFICATIONS_PATH } from './navigation.js';

export function AppLayout(): ReactNode {
  const session = useSession();
  const logout = useLogout();
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const failedCount = useFailedNotifications().data?.total ?? 0;

  // Auf schmalen Bildschirmen scrollt die Navigation waagerecht: aktiven Bereich sichtbar halten.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Buchungsverwaltung</span>
        <div className="app-account">
          {session.data && <span className="app-owner">{session.data.owner.email}</span>}
          <button
            type="button"
            className="button button-secondary"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            {logout.isPending ? 'Abmelden …' : 'Abmelden'}
          </button>
        </div>
      </header>
      {logout.isError && (
        <p className="alert alert-error app-alert" role="alert">
          Abmelden fehlgeschlagen. Bitte die Verbindung prüfen und erneut versuchen.
        </p>
      )}
      <nav ref={navRef} className="app-nav" aria-label="Hauptnavigation">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end={item.path === '/'}>
                {item.label}
                {item.path === NOTIFICATIONS_PATH && failedCount > 0 && (
                  <>
                    {' '}
                    <span className="nav-badge" aria-hidden="true">
                      {failedCount}
                    </span>
                    <span className="visually-hidden">{`(${String(failedCount)} fehlgeschlagen)`}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
