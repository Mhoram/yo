import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type ApprovalBucket, type OutgoingAttachment, type ThreadSummary } from '../lib/api';

export interface ThreadsPage {
  threads: ThreadSummary[];
  nextPageToken?: string;
}
export interface ThreadsInfiniteData {
  pages: ThreadsPage[];
  pageParams: unknown[];
}

export function useThreads(label = 'INBOX') {
  return useInfiniteQuery({
    queryKey: ['threads', label],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => api.listThreads(label, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    // Every Gmail-backed request costs real, tight quota, so don't silently
    // re-fetch a list just because its component remounted (e.g. navigating
    // back from a thread).
    staleTime: 5 * 60_000,
    // Bounds the worst case if a refetch of this infinite query ever does
    // happen: TanStack Query re-fetches the *entire* accumulated page chain
    // on refetch/invalidate, not just page one, so deep scrolling otherwise
    // means deep re-fetch cost too.
    maxPages: 5,
  });
}

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: ['thread', id],
    queryFn: () => api.getThread(id!),
    enabled: Boolean(id),
  });
}

// Shared cache-patch helpers; every mutation here touches ['threads'] data
// directly instead of invalidating, which would re-fetch entire accumulated
// page chains against Gmail for no reason (see ThreadView.tsx for the full
// story on why that matters).
function removeThreadsFromCache(queryClient: QueryClient, ids: Iterable<string>) {
  const idSet = new Set(ids);
  queryClient.setQueriesData<ThreadsInfiniteData>({ queryKey: ['threads'] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        threads: page.threads.filter((t) => !idSet.has(t.id)),
      })),
    };
  });
}

function patchThreadsInCache(queryClient: QueryClient, ids: Iterable<string>, patch: Partial<ThreadSummary>) {
  const idSet = new Set(ids);
  queryClient.setQueriesData<ThreadsInfiniteData>({ queryKey: ['threads'] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        threads: page.threads.map((t) => (idSet.has(t.id) ? { ...t, ...patch } : t)),
      })),
    };
  });
}

// "Mark all as seen" for the New-for-you section.
export function useMarkThreadsSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.markThreadsSeen(ids),
    onSuccess: ({ markedThreadIds }) => {
      if (markedThreadIds.length > 0) patchThreadsInCache(queryClient, markedThreadIds, { unread: false });
    },
  });
}

// "Move to..." reclassifies an approved sender's bucket from a thread view.
export function useMoveSenderBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, bucket }: { email: string; bucket: ApprovalBucket }) => api.moveSenderBucket(email, bucket),
    onSuccess: ({ movedThreadIds }) => {
      if (movedThreadIds.length > 0) removeThreadsFromCache(queryClient, movedThreadIds);
      // Moving can also approve a pending sender (see moveSenderToBucket),
      // which empties their Gatekeeper queue and changes box unread counts.
      queryClient.invalidateQueries({ queryKey: ['gatekeeper'] });
      queryClient.invalidateQueries({ queryKey: ['boxes'] });
    },
  });
}

export function useArchiveThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveThread(id),
    onSuccess: (_data, id) => removeThreadsFromCache(queryClient, [id]),
  });
}

export function useTrashThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.trashThread(id),
    onSuccess: (_data, id) => removeThreadsFromCache(queryClient, [id]),
  });
}

export function useMarkThreadUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markThreadUnread(id),
    onSuccess: (_data, id) => patchThreadsInCache(queryClient, [id], { unread: true }),
  });
}

export function useReplyToThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      ...opts
    }: {
      threadId: string;
      bodyText: string;
      bodyHtml?: string;
      replyAll?: boolean;
      attachments?: OutgoingAttachment[];
    }) => api.replyToThread(threadId, opts),
    onSuccess: (_data, { threadId }) => {
      // A single targeted thread refetch (one threads.get) to pick up the
      // message just sent, not a list invalidation, so no risk of the
      // page-chain re-fetch cost that bit us elsewhere.
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
    },
  });
}

export function useForwardThread() {
  return useMutation({
    mutationFn: ({
      threadId,
      ...opts
    }: {
      threadId: string;
      to: string[];
      note?: string;
      attachments?: OutgoingAttachment[];
    }) => api.forwardThread(threadId, opts),
    // Forwarding creates a new thread elsewhere; nothing in this app's own
    // cached data changes, so no cache patch needed here.
  });
}
