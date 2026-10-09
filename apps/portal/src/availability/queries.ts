import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvailabilityException,
  AvailabilityExceptionCreate,
  AvailabilityExceptionCreated,
  OpeningHoursResponse,
  WeeklyOpeningHours,
} from '@fw-booking/shared';
import { isApiError } from '../api/client.js';
import { useApi } from '../auth/hooks.js';

export const openingHoursQueryKey = ['owner', 'opening-hours'] as const;
/** Ausnahmen ab heute (Standard der API). */
export const exceptionsQueryKey = ['owner', 'availability-exceptions'] as const;

export function useOpeningHours() {
  const api = useApi();
  return useQuery({
    queryKey: openingHoursQueryKey,
    queryFn: ({ signal }) => api.get<OpeningHoursResponse>('/api/owner/opening-hours', { signal }),
  });
}

export function useSaveOpeningHours() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: WeeklyOpeningHours) =>
      api.put<OpeningHoursResponse>('/api/owner/opening-hours', { days }),
    onSuccess: (saved) => {
      queryClient.setQueryData(openingHoursQueryKey, saved);
    },
  });
}

export function useExceptions() {
  const api = useApi();
  return useQuery({
    queryKey: exceptionsQueryKey,
    queryFn: ({ signal }) =>
      api.get<AvailabilityException[]>('/api/owner/availability-exceptions', { signal }),
  });
}

function byStart(a: AvailabilityException, b: AvailabilityException): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
}

export function useCreateException() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AvailabilityExceptionCreate) =>
      api.post<AvailabilityExceptionCreated>('/api/owner/availability-exceptions', input),
    onSuccess: ({ exception }) => {
      queryClient.setQueryData<AvailabilityException[]>(exceptionsQueryKey, (list) =>
        list ? [...list, exception].sort(byStart) : list,
      );
    },
  });
}

export function useDeleteException() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.delete<undefined>(`/api/owner/availability-exceptions/${encodeURIComponent(id)}`);
      } catch (error) {
        // Bereits entfernt (z. B. in einem anderen Tab): Ziel ist erreicht.
        if (!isApiError(error, 404)) throw error;
      }
    },
    onSuccess: (_result, id) => {
      queryClient.setQueryData<AvailabilityException[]>(exceptionsQueryKey, (list) =>
        list?.filter((exception) => exception.id !== id),
      );
    },
  });
}
