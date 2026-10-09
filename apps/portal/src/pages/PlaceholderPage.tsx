import type { ReactNode } from 'react';
import { usePageTitle } from '../layout/usePageTitle.js';

/** Platzhalter für Bereiche, deren Inhalte in späteren Aufgaben folgen. */
export function PlaceholderPage({ title }: { title: string }): ReactNode {
  usePageTitle(title);
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">Dieser Bereich folgt in einem der nächsten Schritte.</p>
    </section>
  );
}
