import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth/hooks.js';
import { NAV_ITEMS } from '../layout/navigation.js';
import { usePageTitle } from '../layout/usePageTitle.js';

export function HomePage(): ReactNode {
  usePageTitle('Übersicht');
  const session = useSession();
  return (
    <section>
      <h1>Übersicht</h1>
      {session.data && <p>Angemeldet als {session.data.owner.email}.</p>}
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
