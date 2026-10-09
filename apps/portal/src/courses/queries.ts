import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CourseRule,
  CourseRuleCreate,
  CourseRuleResult,
  CourseRuleUpdate,
  Session,
  SessionCancelResult,
  SessionCreate,
  SessionUpdate,
} from '@fw-booking/shared';
import { isApiError } from '../api/client.js';
import { useApi } from '../auth/hooks.js';

/** Präfix aller Kurstermin-Abfragen; Änderungen laden alle Wochen neu. */
export const sessionsKey = ['owner', 'sessions'] as const;
export const sessionsWeekKey = (from: string, to: string) =>
  [...sessionsKey, 'list', from, to] as const;
export const sessionKey = (id: string) => [...sessionsKey, 'detail', id] as const;
export const rulesKey = ['owner', 'course-rules'] as const;
export const ruleKey = (id: string) => [...rulesKey, id] as const;

const path = (base: string, id: string): string => `${base}/${encodeURIComponent(id)}`;

/** Optionen für Ansichten, die sich ohne Neuladen aktuell halten (Startansicht). */
export interface RefreshOptions {
  /** Abstand der automatischen Aktualisierung in ms; ohne Angabe keine. */
  refetchInterval?: number;
}

/** Kurstermine eines Zeitraums (lokale Daten, einschließlich), auch abgesagte. */
export function useSessions(from: string, to: string, options: RefreshOptions = {}) {
  const api = useApi();
  return useQuery({
    queryKey: sessionsWeekKey(from, to),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ from, to, includeCancelled: 'true' });
      return api.get<Session[]>(`/api/owner/sessions?${query.toString()}`, { signal });
    },
    ...options,
  });
}

export function useSession(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: sessionKey(id),
    queryFn: ({ signal }) => api.get<Session>(path('/api/owner/sessions', id), { signal }),
  });
}

function useSessionsChanged() {
  const queryClient = useQueryClient();
  return (session?: Session): void => {
    if (session) queryClient.setQueryData(sessionKey(session.id), session);
    void queryClient.invalidateQueries({ queryKey: [...sessionsKey, 'list'] });
    // Absagen ändern Status in Teilnehmerlisten und Buchungsübersicht.
    void queryClient.invalidateQueries({ queryKey: [...sessionsKey, 'participants'] });
    void queryClient.invalidateQueries({ queryKey: ['owner', 'bookings'] });
  };
}

export function useCreateSession() {
  const api = useApi();
  const changed = useSessionsChanged();
  return useMutation({
    mutationFn: (input: SessionCreate) => api.post<Session>('/api/owner/sessions', input),
    onSuccess: (session) => {
      changed(session);
    },
  });
}

export function useUpdateSession() {
  const api = useApi();
  const changed = useSessionsChanged();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SessionUpdate }) =>
      api.patch<Session>(path('/api/owner/sessions', id), patch),
    onSuccess: (session) => {
      changed(session);
    },
  });
}

export function useCancelSession() {
  const api = useApi();
  const changed = useSessionsChanged();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string | null }) =>
      api.post<SessionCancelResult>(`${path('/api/owner/sessions', id)}/cancel`, {
        confirm: true,
        reason,
      }),
    onSuccess: (result) => {
      changed(result.session);
    },
  });
}

export function useDeleteSession() {
  const api = useApi();
  const queryClient = useQueryClient();
  const changed = useSessionsChanged();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.delete<undefined>(path('/api/owner/sessions', id));
      } catch (error) {
        if (!isApiError(error, 404)) throw error;
      }
    },
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: sessionKey(id) });
      changed();
    },
  });
}

export function useCourseRules() {
  const api = useApi();
  return useQuery({
    queryKey: rulesKey,
    queryFn: ({ signal }) => api.get<CourseRule[]>('/api/owner/course-rules', { signal }),
  });
}

export function useCourseRule(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ruleKey(id),
    queryFn: ({ signal }) => api.get<CourseRule>(path('/api/owner/course-rules', id), { signal }),
  });
}

/** Regeländerungen erzeugen oder entfernen Termine: Regeln und Termine neu laden. */
function useRulesChanged() {
  const queryClient = useQueryClient();
  return (rule?: CourseRule): void => {
    if (rule) queryClient.setQueryData(ruleKey(rule.id), rule);
    void queryClient.invalidateQueries({ queryKey: rulesKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: sessionsKey });
  };
}

export function useCreateRule() {
  const api = useApi();
  const changed = useRulesChanged();
  return useMutation({
    mutationFn: (input: CourseRuleCreate) =>
      api.post<CourseRuleResult>('/api/owner/course-rules', input),
    onSuccess: (result) => {
      changed(result.rule);
    },
  });
}

export function useUpdateRule() {
  const api = useApi();
  const changed = useRulesChanged();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CourseRuleUpdate }) =>
      api.patch<CourseRuleResult>(path('/api/owner/course-rules', id), patch),
    onSuccess: (result) => {
      changed(result.rule);
    },
  });
}

export function useDeleteRule() {
  const api = useApi();
  const queryClient = useQueryClient();
  const changed = useRulesChanged();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ keptWithBookings: string[] }>(path('/api/owner/course-rules', id)),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: ruleKey(id) });
      changed();
    },
  });
}
