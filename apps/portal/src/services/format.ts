import type { Service } from '@fw-booking/shared';

export type ServiceType = Service['type'];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  single: 'Einzeltermin',
  group: 'Gruppenkurs',
};

export const SERVICE_TYPE_HINTS: Record<ServiceType, string> = {
  single: 'Kunden wählen eine freie Uhrzeit innerhalb der Öffnungszeiten; ein Platz je Termin.',
  group: 'Feste Kurstermine mit mehreren Plätzen.',
};

/** Dauer lesbar, z. B. „45 Min.“, „1 Std.“, „1 Std. 30 Min.“. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} Min.`;
  return rest === 0 ? `${String(hours)} Std.` : `${String(hours)} Std. ${String(rest)} Min.`;
}

/** Kurzbeschreibung für die Liste, z. B. „Gruppenkurs · 1 Std. · 12 Plätze“. */
export function serviceSummary(service: Service): string {
  const parts = [SERVICE_TYPE_LABELS[service.type], formatDuration(service.durationMinutes)];
  if (service.type === 'group') parts.push(`${String(service.defaultCapacity)} Plätze`);
  return parts.join(' · ');
}
