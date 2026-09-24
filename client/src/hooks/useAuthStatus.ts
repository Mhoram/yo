import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth-status'],
    queryFn: api.authStatus,
    staleTime: 30_000,
  });
}
