import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSearchThreads(q: string) {
  const trimmed = q.trim();
  return useInfiniteQuery({
    queryKey: ['search', trimmed],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => api.searchThreads(trimmed, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: trimmed.length > 0,
    // A search is an explicit, already-deliberate action, so no reason to
    // silently re-run it on remount within a session, same reasoning as the
    // list views.
    staleTime: 5 * 60_000,
    maxPages: 5,
  });
}

const PREVIEW_LIMIT = 5;

// Separate query key (and a small server-side `limit`) from useSearchThreads
// so the nav bar's live-as-you-type dropdown doesn't pull a full 20-thread
// page: each thread costs a real Gmail quota unit, and this fires on a
// debounce while typing rather than on one deliberate submit.
export function useSearchPreview(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['search-preview', trimmed],
    queryFn: () => api.searchThreads(trimmed, undefined, PREVIEW_LIMIT),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
  });
}
