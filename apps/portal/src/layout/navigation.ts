/** Hauptbereiche des Portals; die Inhalte folgen in task-5-2 bis task-5-6. */
export interface NavItem {
  path: string;
  label: string;
}

/** Bereich mit Zahl fehlgeschlagener Benachrichtigungen in der Navigation. */
export const NOTIFICATIONS_PATH = '/benachrichtigungen';

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Übersicht' },
  { path: '/angebote', label: 'Angebote' },
  { path: '/oeffnungszeiten', label: 'Öffnungszeiten' },
  { path: '/kurstermine', label: 'Kurstermine' },
  { path: '/buchungen', label: 'Buchungen' },
  { path: '/benachrichtigungen', label: 'Benachrichtigungen' },
];
