// Buchungen und Teilnehmerlisten enthalten personenbezogene Daten: nur im Arbeitsspeicher,
// kurz im Cache und beim Abmelden verworfen (siehe auth/session.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, OwnerBookingCancelResult, SessionParticipants } from '@fw-booking/shared';
import { useApi } from '../auth/hooks.js';
import { sessionsKey } from '../courses/queries.js';
import type { DateRange } from './range.js';

export const bookingsKey = ['owner', 'bookings'] as const;
export const bookingListKey = (range: DateRange, serviceId: string, all: boolean) =>
  [...bookingsKey, 'list', range.from, range.to, serviceId, all] as const;
export const bookingKey = (id: string) => [...bookingsKey, 'detail', id] as const;
export const participantsKey = (sessionId: string) =>
  [...sessionsKey, 'participants', sessionId] as const;

/** Nicht mehr angezeigte Teilnehmerdaten schnell aus dem Speicher entfernen. */
const PERSONAL_DATA_GC_MS = 60_000;

export function useBookings(range: DateRange, serviceId: string, all: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: bookingListKey(range, serviceId, all),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ from: range.from, to: range.to });
      if (serviceId) query.set('serviceId', serviceId);
      if (!all) query.set('status', 'confirmed');
      return api.get<Booking[]>(`/api/owner/bookings?${query.toString()}`, { signal });
    },
    gcTime: PERSONAL_DATA_GC_MS,
  });
}

export function useBooking(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: bookingKey(id),
    queryFn: ({ signal }) =>
      api.get<Booking>(`/api/owner/bookings/${encodeURIComponent(id)}`, { signal }),
    gcTime: PERSONAL_DATA_GC_MS,
  });
}

export function useSessionParticipants(sessionId: string) {
  const api = useApi();
  return useQuery({
    queryKey: participantsKey(sessionId),
    queryFn: ({ signal }) =>
      api.get<SessionParticipants>(
        `/api/owner/sessions/${encodeURIComponent(sessionId)}/participants`,
        { signal },
      ),
    gcTime: PERSONAL_DATA_GC_MS,
  });
}

export function useCancelBooking() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string | null }) =>
      api.post<OwnerBookingCancelResult>(`/api/owner/bookings/${encodeURIComponent(id)}/cancel`, {
        confirm: true,
        reason,
      }),
    onSuccess: ({ booking }) => {
      queryClient.setQueryData(bookingKey(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: [...bookingsKey, 'list'] });
      // Belegung und Teilnehmerliste des Kurstermins ändern sich mit.
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}
