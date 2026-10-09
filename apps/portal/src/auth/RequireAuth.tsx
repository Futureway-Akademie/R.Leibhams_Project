import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { StatusScreen } from '../layout/StatusScreen.js';
import { useSession } from './hooks.js';
import { LOGIN_PATH } from './redirect.js';
import type { LoginRedirectState } from './redirect.js';

/** Schützt alle untergeordneten Seiten: ohne Sitzung Weiterleitung zum Login. */
export function RequireAuth(): ReactNode {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <StatusScreen>Sitzung wird geprüft …</StatusScreen>;
  // Hintergrund-Prüfung fehlgeschlagen, aber Sitzung bekannt: weiterarbeiten.
  if (session.data === undefined) {
    return (
      <StatusScreen
        action={{
          label: 'Erneut versuchen',
          onClick: () => void session.refetch(),
        }}
      >
        Der Server ist gerade nicht erreichbar.
      </StatusScreen>
    );
  }
  if (!session.data) {
    const state: LoginRedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to={LOGIN_PATH} replace state={state} />;
  }
  return <Outlet />;
}
