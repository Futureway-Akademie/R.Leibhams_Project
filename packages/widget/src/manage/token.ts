// Verwaltungslink MANAGE_PAGE_URL#t=TOKEN: Das Token wird beim Laden des Scripts gelesen und das
// Fragment sofort per history.replaceState entfernt, damit es weder in der Adresszeile, im
// Verlauf noch in später gelesenen URLs (Analytics, Weiterleitungen) erscheint. Es bleibt
// ausschließlich im Arbeitsspeicher.

/** Format eines Verwaltungs-Tokens (256 Bit, base64url), wie bookingTokenSchema in shared. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `null`: kein Verwaltungslink; `invalid`: Fragment vorhanden, aber kein gültiges Token. */
export type ManageToken = { kind: 'token'; token: string } | { kind: 'invalid' } | null;

export function takeManageToken(win: Window): ManageToken {
  const hash = win.location.hash;
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has('t')) return null;
  const value = params.get('t') ?? '';
  removeFragment(win);
  return TOKEN_PATTERN.test(value) ? { kind: 'token', token: value } : { kind: 'invalid' };
}

function removeFragment(win: Window): void {
  const { pathname, search } = win.location;
  try {
    win.history.replaceState(win.history.state, '', `${pathname}${search}`);
  } catch {
    // Ohne History-API (z. B. sandboxed) wenigstens das Fragment leeren.
    win.location.hash = '';
  }
}
