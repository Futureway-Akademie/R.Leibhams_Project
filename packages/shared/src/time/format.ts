// Anzeige von UTC-Zeitpunkten in der Zeitzone der Installation.
// Nutzt nur Intl, damit Widget und Portal den Temporal-Polyfill nicht laden müssen.

export const DEFAULT_LOCALE = 'de-DE';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, cached);
  }
  return cached;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

/** z. B. „Do., 8. Okt. 2026“ */
export function formatDate(utc: string, timeZone: string, locale = DEFAULT_LOCALE): string {
  return formatter(locale, timeZone, DATE_OPTIONS).format(new Date(utc));
}

/** z. B. „10:00“ */
export function formatTime(utc: string, timeZone: string, locale = DEFAULT_LOCALE): string {
  return formatter(locale, timeZone, TIME_OPTIONS).format(new Date(utc));
}

/** z. B. „Do., 8. Okt. 2026, 10:00“ */
export function formatDateTime(utc: string, timeZone: string, locale = DEFAULT_LOCALE): string {
  return `${formatDate(utc, timeZone, locale)}, ${formatTime(utc, timeZone, locale)}`;
}

/** z. B. „10:00–10:30“ */
export function formatTimeRange(
  startUtc: string,
  endUtc: string,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  return `${formatTime(startUtc, timeZone, locale)}–${formatTime(endUtc, timeZone, locale)}`;
}

/** Ob das Gerät eine andere Zeitzone als die Installation verwendet (dann Hinweis anzeigen). */
export function differsFromDeviceTimeZone(
  timeZone: string,
  deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): boolean {
  return deviceTimeZone !== timeZone;
}
