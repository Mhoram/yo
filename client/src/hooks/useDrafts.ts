import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Draft, type DraftInput } from '../lib/api';

// Drafts list: backs the box-menu count and the Drafts page. Cheap local
// query, so a short staleTime is enough to keep the count fresh-ish without
// invalidation ceremony everywhere.
export function useDrafts() {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: api.listDrafts,
    staleTime: 30 * 1000,
    select: (data: { drafts: Draft[] }) => data.drafts,
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DraftInput) => api.saveDraft(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drafts'] }),
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteDraft(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drafts'] }),
  });
}

/** The one saved draft for a thread's reply/forward compose box, if any. */
export function useDraftForThread(threadId: string | undefined, kind: 'reply' | 'forward') {
  return useQuery({
    queryKey: ['drafts', threadId, kind],
    queryFn: () => api.findDraft(threadId!, kind),
    enabled: Boolean(threadId),
    staleTime: 30 * 1000,
  });
}

/** One draft by id — reopening a saved draft from the Drafts page. */
export function useDraftById(id: number | undefined) {
  return useQuery({
    queryKey: ['drafts', id],
    queryFn: () => api.getDraft(id!),
    enabled: id !== undefined && Number.isInteger(id),
  });
}
