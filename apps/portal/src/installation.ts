import { DEFAULT_TIME_ZONE } from '@fw-booking/shared';
import type { OwnerCalendarResponse } from '@fw-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './auth/hooks.js';

export const installationQueryKey = ['owner', 'calendar'] as const;

/** Kalenderkennung und Zeitzone der Installation; ändern sich im Betrieb nicht. */
export function useInstallation() {
  const api = useApi();
  return useQuery({
    queryKey: installationQueryKey,
    queryFn: ({ signal }) => api.get<OwnerCalendarResponse>('/api/owner/calendar', { signal }),
    staleTime: Infinity,
  });
}

/** Zeitzone der Installation; bis zur Antwort der Standard. */
export function useTimeZone(): { timeZone: string; ready: boolean } {
  const installation = useInstallation();
  return {
    timeZone: installation.data?.timeZone ?? DEFAULT_TIME_ZONE,
    ready: !installation.isPending,
  };
}
