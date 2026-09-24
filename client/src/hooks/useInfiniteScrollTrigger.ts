import { useEffect, useRef, type RefObject } from 'react';

// Each infinite-scroll page can itself cost real Gmail quota (up to ~30
// threads * ~50 units in the worst case), and the sentinel re-enters view
// repeatedly while scrolling fast. Without a cooldown, quick scrolling
// through a long list could fire several of these in a row and blow the
// per-minute quota. Caps to at most one fetch per cooldownMs regardless of
// how often the sentinel re-intersects.
export function useInfiniteScrollTrigger(
  sentinelRef: RefObject<HTMLElement | null>,
  {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    cooldownMs = 5000,
  }: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => void;
    cooldownMs?: number;
  },
) {
  const lastFetchAtRef = useRef(0);
  const retryTimeoutRef = useRef<number | undefined>(undefined);
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    function attemptFetch() {
      if (!isIntersectingRef.current || !hasNextPage || isFetchingNextPage) return;
      const now = Date.now();
      const elapsed = now - lastFetchAtRef.current;
      if (elapsed >= cooldownMs) {
        lastFetchAtRef.current = now;
        fetchNextPage();
      } else if (retryTimeoutRef.current === undefined) {
        retryTimeoutRef.current = window.setTimeout(() => {
          retryTimeoutRef.current = undefined;
          attemptFetch();
        }, cooldownMs - elapsed);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        isIntersectingRef.current = entries[0].isIntersecting;
        if (isIntersectingRef.current) attemptFetch();
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (retryTimeoutRef.current !== undefined) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }
    };
  }, [sentinelRef, fetchNextPage, hasNextPage, isFetchingNextPage, cooldownMs]);
}
