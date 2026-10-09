import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '../layout/usePageTitle.js';

export function NotFoundPage(): ReactNode {
  usePageTitle('Seite nicht gefunden');
  return (
    <section>
      <h1>Seite nicht gefunden</h1>
      <p>
        <Link to="/">Zur Übersicht</Link>
      </p>
    </section>
  );
}
