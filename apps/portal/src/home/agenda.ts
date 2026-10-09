// Tagesplan der Startansicht: Kurstermine und Einzeltermine eines Tages in zeitlicher Reihenfolge.
// Einzeltermine kommen aus den Buchungen; Namen zeigt erst die Detailansicht.
import type { Booking, Session } from '@fw-booking/shared';
import { addDays, formatLocalDate, isDate } from '../availability/time.js';

export type AgendaItem =
  | { kind: 'session'; id: string; startsAt: string; endsAt: string; session: Session }
  | { kind: 'single'; id: string; startsAt: string; endsAt: string; booking: Booking };

/** Wie weit „Als Nächstes“ nach einem Termin sucht (Tage einschließlich Starttag). */
export const NEXT_SEARCH_DAYS = 31;

/** Kurstermine (auch abgesagte) und bestätigte Einzeltermine, nach Beginn sortiert. */
export function buildAgenda(
  sessions: readonly Session[],
  bookings: readonly Booking[],
): AgendaItem[] {
  const items: AgendaItem[] = [
    ...sessions.map((session) => ({
      kind: 'session' as const,
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      session,
    })),
    ...bookings
      .filter((booking) => booking.type === 'single' && booking.status === 'confirmed')
      .map((booking) => ({
        kind: 'single' as const,
        id: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        booking,
      })),
  ];
  return items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Findet statt: nicht abgesagt (gesperrte Kurstermine finden mit ihren Teilnehmern statt). */
export function takesPlace(item: AgendaItem): boolean {
  return item.kind === 'single' || item.session.status !== 'cancelled';
}

export type ItemTiming = 'past' | 'running' | 'upcoming';

export function timingOf(item: AgendaItem, now: number): ItemTiming {
  if (Date.parse(item.endsAt) <= now) return 'past';
  return Date.parse(item.startsAt) <= now ? 'running' : 'upcoming';
}

/** Gibt es an diesem Tag noch etwas, das stattfindet und nicht vorbei ist? */
export function hasRemaining(items: readonly AgendaItem[], now: number): boolean {
  return items.some((item) => takesPlace(item) && timingOf(item, now) !== 'past');
}

/** Nächster stattfindender Termin, der nach `now` beginnt. */
export function nextItem(items: readonly AgendaItem[], now: number): AgendaItem | null {
  return items.find((item) => takesPlace(item) && Date.parse(item.startsAt) > now) ?? null;
}

/**
 * Suchzeitraum für „Als Nächstes“: ab heute für vergangene Tage und heute, sonst ab dem Folgetag
 * des angezeigten (leeren) Tages.
 */
export function nextSearchRange(day: string, today: string): { from: string; to: string } {
  const from = day > today ? addDays(day, 1) : today;
  return { from, to: addDays(from, NEXT_SEARCH_DAYS - 1) };
}

/** Angezeigter Tag aus `?tag=YYYY-MM-DD`; fehlt er oder ist er ungültig, gilt heute. */
export function dayFromParam(value: string | null, today: string): string {
  return value !== null && isDate(value) ? value : today;
}

/** „Heute, Sa., 10.10.2026“, „Morgen, …“, „Gestern, …“ oder nur das Datum. */
export function dayHeading(day: string, today: string): string {
  const date = formatLocalDate(day);
  if (day === today) return `Heute, ${date}`;
  if (day === addDays(today, 1)) return `Morgen, ${date}`;
  if (day === addDays(today, -1)) return `Gestern, ${date}`;
  return date;
}

/** Uhrzeit eines Zeitstempels (ms) in der Zeitzone der Installation, z. B. „14:32“. */
export function formatClock(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}
