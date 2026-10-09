import { useEffect } from 'react';

export const APP_NAME = 'Buchungsverwaltung';

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} – ${APP_NAME}`;
  }, [title]);
}
