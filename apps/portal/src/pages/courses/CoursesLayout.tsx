import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

/** Reiter „Termine“ und „Regeln“ für Gruppenkurse; Detailseiten gehören zum jeweiligen Reiter. */
export function CoursesLayout(): ReactNode {
  const { pathname } = useLocation();
  const rules = pathname.startsWith('/kurstermine/regeln');
  return (
    <>
      <h1>Kurstermine</h1>
      <nav className="tabs" aria-label="Kurstermine">
        <Link
          to="/kurstermine"
          className={rules ? undefined : 'active'}
          aria-current={rules ? undefined : 'page'}
        >
          Termine
        </Link>
        <Link
          to="/kurstermine/regeln"
          className={rules ? 'active' : undefined}
          aria-current={rules ? 'page' : undefined}
        >
          Regeln
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
