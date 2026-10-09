import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** Hinweis nach einer Aktion, übergeben über den Navigationszustand und nur einmal angezeigt. */
export interface FlashState {
  flash: {
    tone: 'success' | 'warning';
    text: string;
    details?: { title: string; items: string[] }[];
  };
}

function readFlash(state: unknown): FlashState['flash'] | null {
  if (typeof state !== 'object' || state === null || !('flash' in state)) return null;
  const flash = (state as Partial<FlashState>).flash;
  return flash && typeof flash.text === 'string' ? flash : null;
}

/** Liest den Hinweis einmal und entfernt ihn aus dem Verlauf (fehlt nach dem Neuladen). */
export function useFlash(): FlashState['flash'] | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [flash] = useState(() => readFlash(location.state));
  useEffect(() => {
    if (readFlash(location.state)) {
      void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);
  return flash;
}

export function FlashMessage({ flash }: { flash: FlashState['flash'] | null }): ReactNode {
  if (!flash) return null;
  return (
    <div
      className={flash.tone === 'success' ? 'alert alert-success' : 'alert alert-warning'}
      role="status"
    >
      <p>{flash.text}</p>
      {flash.details
        ?.filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.title}>
            <p>{group.title}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
