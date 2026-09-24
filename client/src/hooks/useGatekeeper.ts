import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApprovalBucket } from '../lib/api';

export function usePendingSenders() {
  return useQuery({
    queryKey: ['gatekeeper'],
    queryFn: api.listPendingSenders,
  });
}

export function useBlockedSenders() {
  return useQuery({
    queryKey: ['gatekeeper-blocked'],
    queryFn: api.listBlockedSenders,
  });
}

export function useGatekeeperDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, action, bucket }: { email: string; action: 'approve' | 'block'; bucket?: ApprovalBucket }) =>
      action === 'approve' ? api.approveSender(email, bucket) : api.blockSender(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatekeeper'] });
      queryClient.invalidateQueries({ queryKey: ['gatekeeper-blocked'] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}
