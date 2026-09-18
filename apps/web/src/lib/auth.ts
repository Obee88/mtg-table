import type { LoginInput, RegisterInput, User } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from './api';

const ME = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api<User>('/me');
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginInput) => api<User>('/auth/login', { body }),
    onSuccess: (user) => qc.setQueryData(ME, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterInput) => api<User>('/auth/register', { body }),
    onSuccess: (user) => qc.setQueryData(ME, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', body: {} }),
    onSuccess: () => qc.setQueryData(ME, null),
  });
}
