import type { ReactNode } from 'react';

/** Ganzseitiger Hinweis (Laden, Fehler) außerhalb des Layouts. */
export function StatusScreen({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}): ReactNode {
  return (
    <main className="status-screen">
      <p role="status">{children}</p>
      {action && (
        <button type="button" className="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </main>
  );
}
