/** Zustand der Weiterleitung zum Login: Ziel nach erfolgreicher Anmeldung. */
export interface LoginRedirectState {
  from: string;
}

export const LOGIN_PATH = '/login';

/**
 * Ziel nach dem Login. Nur Pfade innerhalb des Portals (kein `//host`, kein Login selbst), sonst
 * die Startseite.
 */
export function redirectTarget(state: unknown): string {
  const from =
    typeof state === 'object' && state !== null && 'from' in state ? state.from : undefined;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/';
  if (from.startsWith('/\\') || from === LOGIN_PATH || from.startsWith(`${LOGIN_PATH}?`))
    return '/';
  return from;
}
