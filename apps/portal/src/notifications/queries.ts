import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FailedNotificationsResponse,
  NotificationActionResult,
  NotificationType,
} from '@fw-booking/shared';
import { useApi } from '../auth/hooks.js';

export const notificationsKey = ['owner', 'notifications'] as const;
export const failedKey = (type: NotificationType | '') =>
  [...notificationsKey, 'failed', type] as const;

/** Fehlschläge sollen auch ohne Neuladen auffallen (Zahl in der Navigation). */
const REFRESH_MS = 5 * 60_000;

export function useFailedNotifications(type: NotificationType | '' = '') {
  const api = useApi();
  return useQuery({
    queryKey: failedKey(type),
    queryFn: ({ signal }) => {
      const query = type ? `?${new URLSearchParams({ type }).toString()}` : '';
      return api.get<FailedNotificationsResponse>(`/api/owner/notifications/failed${query}`, {
        signal,
      });
    },
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    // Enthält Kontaktdaten: nach dem Verlassen der Seite nicht lange im Speicher halten.
    gcTime: 60_000,
  });
}

function useNotificationAction(action: 'retry' | 'dismiss') {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<NotificationActionResult>(
        `/api/owner/notifications/failed/${encodeURIComponent(id)}/${action}`,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

export const useRetryNotification = () => useNotificationAction('retry');
export const useDismissNotification = () => useNotificationAction('dismiss');
