import type { Booking } from '@fw-booking/shared';

export const BOOKING_STATUS_LABELS: Record<Booking['status'], string> = {
  confirmed: 'Bestätigt',
  cancelled: 'Storniert',
  rebooked: 'Umgebucht',
  cancelled_by_owner: 'Abgesagt',
};

export function isActive(booking: Pick<Booking, 'status'>): boolean {
  return booking.status === 'confirmed';
}

/** Telefonnummer für `tel:`-Links (nur Ziffern und führendes +). */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace('%40', '@')}`;
}
