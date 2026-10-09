// Konfiguration eines Widget-Containers aus seinen Datenattributen:
// <div data-fw-booking-calendar="cal_…" data-fw-booking-api="https://buchung.example.de"></div>

/** Selektor, an dem das Widget seine Container erkennt. */
export const CONTAINER_SELECTOR = '[data-fw-booking-calendar]';

const CALENDAR_ID_PATTERN = /^cal_[A-Za-z0-9_-]{16,}$/;

export interface WidgetConfig {
  calendarId: string;
  /** Basisadresse der Buchungs-API ohne abschließenden Schrägstrich. */
  apiUrl: string;
}

export type ConfigResult = { ok: true; config: WidgetConfig } | { ok: false; reason: string };

export function readConfig(container: HTMLElement): ConfigResult {
  const calendarId = container.dataset['fwBookingCalendar']?.trim() ?? '';
  if (!CALENDAR_ID_PATTERN.test(calendarId)) {
    return { ok: false, reason: 'data-fw-booking-calendar fehlt oder ist ungültig' };
  }
  const apiUrl = parseApiUrl(container.dataset['fwBookingApi']);
  if (apiUrl === null) {
    return { ok: false, reason: 'data-fw-booking-api fehlt oder ist keine http(s)-Adresse' };
  }
  return { ok: true, config: { calendarId, apiUrl } };
}

function parseApiUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Query und Fragment gehören nicht zur Basisadresse.
  if (url.search !== '' || url.hash !== '') return null;
  return url.href.replace(/\/+$/, '');
}
