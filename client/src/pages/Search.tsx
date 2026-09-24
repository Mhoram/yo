import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { ThreadRow } from '../components/ThreadRow';
import { useSearchThreads } from '../hooks/useSearch';
import { useInfiniteScrollTrigger } from '../hooks/useInfiniteScrollTrigger';

export function Search() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useSearchThreads(q);
  useInfiniteScrollTrigger(sentinelRef, { hasNextPage, isFetchingNextPage, fetchNextPage });

  const threads = data?.pages.flatMap((page) => page.threads) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10 sm:px-6">
      <NavBar />
      <div className="mb-8 mt-6 flex items-center justify-between gap-3 sm:block">
        <h1 className="text-left text-4xl font-bold sm:text-center">{q ? `Results for "${q}"` : 'Search'}</h1>
        <Link
          to="/compose"
          className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:hidden"
        >
          + Write
        </Link>
      </div>

      {!q && <p className="text-center text-muted-foreground">Type in the search box above and press Enter.</p>}

      {q && (
        <>
          {isLoading && <p className="mt-8 text-center text-muted-foreground">Searching...</p>}
          {error && <p className="mt-8 text-center text-red-400">Search failed: {(error as Error).message}</p>}
          <ul className="mt-6 divide-y divide-border">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
          {!isLoading && !error && threads.length === 0 && (
            <p className="mt-8 text-center text-muted-foreground">No results for "{q}".</p>
          )}
          <div ref={sentinelRef} />
          {isFetchingNextPage && <p className="py-4 text-center text-sm text-muted-foreground">Loading more...</p>}
          {!hasNextPage && threads.length > 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">That's everything.</p>
          )}
        </>
      )}
    </div>
  );
}
