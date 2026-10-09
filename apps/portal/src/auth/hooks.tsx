import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { LoginRequest } from '@fw-booking/shared';
import type { ApiClient } from '../api/client.js';
import { login, logout, sessionQueryOptions } from './session.js';
import type { Portal } from './session.js';

const ApiContext = createContext<ApiClient | null>(null);

export function PortalProvider({
  portal,
  children,
}: {
  portal: Portal;
  children: ReactNode;
}): ReactNode {
  return (
    <QueryClientProvider client={portal.queryClient}>
      <ApiContext value={portal.api}>{children}</ApiContext>
    </QueryClientProvider>
  );
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi außerhalb von PortalProvider');
  return api;
}

export function useSession() {
  return useQuery(sessionQueryOptions(useApi()));
}

export function useLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginRequest) => login(api, queryClient, credentials),
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => logout(api, queryClient) });
}
