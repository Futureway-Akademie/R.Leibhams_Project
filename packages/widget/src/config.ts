// Konfiguration eines Widget-Containers aus seinen Datenattributen:
// <div data-fw-booking-calendar="cal_…" data-fw-booking-api="https://buchung.example.de"></div>
// Pflicht ist außerdem data-fw-booking-privacy-url (Datenschutzhinweise der einbindenden Seite);
// optional legt data-fw-booking-service="<Angebots-ID>" den Container auf ein Angebot fest.

/** Selektor, an dem das Widget seine Container erkennt. */
export const CONTAINER_SELECTOR = '[data-fw-booking-calendar]';

const CALENDAR_ID_PATTERN = /^cal_[A-Za-z0-9_-]{16,}$/;
const SERVICE_ID_PATTERN = /^[0-9a-f]{24}$/;

export interface WidgetConfig {
  calendarId: string;
  /** Basisadresse der Buchungs-API ohne abschließenden Schrägstrich. */
  apiUrl: string;
  /** Festes Angebot; ohne Angabe zeigt das Widget alle Angebote zur Auswahl. */
  serviceId: string | null;
  /** Absolute Adresse der Datenschutzhinweise, verlinkt an der Pflicht-Checkbox. */
  privacyUrl: string;
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
  const privacyUrl = parsePrivacyUrl(
    container.dataset['fwBookingPrivacyUrl'],
    container.ownerDocument.baseURI,
  );
  if (privacyUrl === null) {
    return {
      ok: false,
      reason: 'data-fw-booking-privacy-url fehlt oder ist keine http(s)-Adresse',
    };
  }
  const rawService = container.dataset['fwBookingService']?.trim();
  let serviceId: string | null = null;
  if (rawService !== undefined && rawService !== '') {
    if (!SERVICE_ID_PATTERN.test(rawService)) {
      return { ok: false, reason: 'data-fw-booking-service ist keine gültige Angebots-ID' };
    }
    serviceId = rawService;
  }
  return { ok: true, config: { calendarId, apiUrl, serviceId, privacyUrl } };
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

/** Datenschutzseite: auch relativ zur Seite und mit Query (z. B. WordPress `?page_id=3`). */
function parsePrivacyUrl(value: string | undefined, base: string): string | null {
  if (value === undefined || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.href;
}
