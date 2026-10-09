// Datenzugriff auf die Owner-API für Angebote. Die Liste wird immer vollständig geladen, weil die
// Reihenfolge-Aktion alle Angebote erwartet; gefiltert wird im Portal.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Service, ServiceCreate, ServiceUpdate } from '@fw-booking/shared';
import { useApi } from '../auth/hooks.js';

export const servicesQueryKey = ['owner', 'services'] as const;
export const serviceQueryKey = (id: string) => ['owner', 'services', id] as const;

export function useServices() {
  const api = useApi();
  return useQuery({
    queryKey: servicesQueryKey,
    queryFn: ({ signal }) => api.get<Service[]>('/api/owner/services', { signal }),
  });
}

export function useService(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: serviceQueryKey(id),
    queryFn: ({ signal }) =>
      api.get<Service>(`/api/owner/services/${encodeURIComponent(id)}`, { signal }),
  });
}

/** Übernimmt ein gespeichertes Angebot in Liste und Einzelansicht. */
function useStoreService() {
  const queryClient = useQueryClient();
  return (service: Service): void => {
    queryClient.setQueryData(serviceQueryKey(service.id), service);
    queryClient.setQueryData<Service[]>(servicesQueryKey, (list) => {
      if (!list) return list;
      const index = list.findIndex((s) => s.id === service.id);
      return index === -1
        ? [...list, service]
        : list.map((s) => (s.id === service.id ? service : s));
    });
  };
}

export function useCreateService() {
  const api = useApi();
  const store = useStoreService();
  return useMutation({
    mutationFn: (input: ServiceCreate) => api.post<Service>('/api/owner/services', input),
    onSuccess: store,
  });
}

export function useUpdateService() {
  const api = useApi();
  const store = useStoreService();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ServiceUpdate }) =>
      api.patch<Service>(`/api/owner/services/${encodeURIComponent(id)}`, patch),
    onSuccess: store,
  });
}

/** Neue Reihenfolge aller Angebote; die Liste zeigt sie sofort und stellt sie bei Fehlern wieder her. */
export function useReorderServices() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceIds: string[]) =>
      api.put<Service[]>('/api/owner/services/order', { serviceIds }),
    onMutate: async (serviceIds) => {
      await queryClient.cancelQueries({ queryKey: servicesQueryKey, exact: true });
      const previous = queryClient.getQueryData<Service[]>(servicesQueryKey);
      if (previous) {
        const byId = new Map(previous.map((s) => [s.id, s]));
        queryClient.setQueryData<Service[]>(
          servicesQueryKey,
          serviceIds.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(servicesQueryKey, context.previous);
      // Liste könnte sich inzwischen geändert haben (z. B. in einem anderen Tab).
      void queryClient.invalidateQueries({ queryKey: servicesQueryKey, exact: true });
    },
    onSuccess: (services) => {
      queryClient.setQueryData(servicesQueryKey, services);
    },
  });
}
