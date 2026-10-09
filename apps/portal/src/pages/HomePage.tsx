import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth/hooks.js';
import { NAV_ITEMS, NOTIFICATIONS_PATH } from '../layout/navigation.js';
import { useFailedNotifications } from '../notifications/queries.js';
import { usePageTitle } from '../layout/usePageTitle.js';

export function HomePage(): ReactNode {
  usePageTitle('Übersicht');
  const session = useSession();
  const failedCount = useFailedNotifications().data?.total ?? 0;
  return (
    <section>
      <h1>Übersicht</h1>
      {session.data && <p>Angemeldet als {session.data.owner.email}.</p>}
      {failedCount > 0 && (
        <p className="alert alert-warning">
          {failedCount === 1
            ? '1 E-Mail an Teilnehmer konnte nicht zugestellt werden. '
            : `${String(failedCount)} E-Mails an Teilnehmer konnten nicht zugestellt werden. `}
          <Link to={NOTIFICATIONS_PATH}>Benachrichtigungen ansehen</Link>
        </p>
      )}
      <ul className="tile-list">
        {NAV_ITEMS.filter((item) => item.path !== '/').map((item) => (
          <li key={item.path}>
            <Link className="tile" to={item.path}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
