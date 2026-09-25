import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useThreads, useMarkThreadsSeen } from '../hooks/useThreads';
import { useInfiniteScrollTrigger } from '../hooks/useInfiniteScrollTrigger';
import { ThreadRow } from './ThreadRow';
import { NavBar } from './NavBar';

function SectionHeading({
  children,
  withRule,
  action,
}: {
  children: React.ReactNode;
  withRule?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="mb-4 mt-6 flex items-center gap-3 first:mt-0">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {withRule && (
        <span className="relative flex flex-1 items-center">
          <span className="h-px w-full bg-border" />
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="absolute right-0 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {action.label}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export function ThreadList({
  label,
  title,
  emptyMessage,
  perspective = 'received',
}: {
  label: string;
  title: string;
  emptyMessage: string;
  perspective?: 'received' | 'sent';
}) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useThreads(label);
  const markSeen = useMarkThreadsSeen();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useInfiniteScrollTrigger(sentinelRef, { hasNextPage, isFetchingNextPage, fetchNextPage });

  const threads = data?.pages.flatMap((page) => page.threads) ?? [];
  // "New for you" is scoped to the first page only, not recomputed from
  // every accumulated page. Otherwise, for an account with a large backlog
  // of genuinely-unread-in-Gmail old mail, each infinite-scroll fetch would
  // keep dumping more old threads into this section (which renders above
  // "Previously seen"), growing it and shifting content out from under
  // whatever the user is currently scrolled through. Once a thread has
  // loaded past the first page, it's history being paged through, not
  // "new"; it goes straight to "Previously seen" regardless of its Gmail
  // unread flag.
  const firstPageThreads = data?.pages[0]?.threads ?? [];
  const newForYou = firstPageThreads.filter((t) => t.unread);
  const newForYouIds = new Set(newForYou.map((t) => t.id));
  const previouslySeen = threads.filter((t) => !newForYouIds.has(t.id));

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10 sm:px-6">
      <NavBar />

      <div
        className={`mt-6 overflow-hidden bg-background px-1 pb-2 pt-6 sm:bg-muted sm:px-6 ${previouslySeen.length > 0 ? 'rounded-t-xl' : 'rounded-xl'}`}
      >
        <div className="flex items-center justify-between gap-3 sm:block">
          <h1 className="text-left text-4xl font-bold sm:text-center">{title}</h1>
          <Link
            to="/compose"
            className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:hidden"
          >
            + Write
          </Link>
        </div>
        <span className="mt-4 block h-px w-full rounded-full bg-gradient-to-r from-[#39ff14] to-[#00d4ff]" />
        {newForYou.length > 0 && (
          <SectionHeading
            withRule
            action={{
              label: markSeen.isPending ? 'Marking…' : 'Mark all as seen',
              disabled: markSeen.isPending,
              onClick: () => markSeen.mutate(newForYou.map((t) => t.id)),
            }}
          >
            New for you
          </SectionHeading>
        )}
        {newForYou.length > 0 ? (
          <ul className="divide-y divide-border">
            {newForYou.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} perspective={perspective} />
            ))}
          </ul>
        ) : (
          !isLoading && !error && <p className="mt-6 pb-4 text-center text-muted-foreground">Nothing new for you</p>
        )}
      </div>

      {isLoading && <p className="mt-6 text-center text-muted-foreground">Loading...</p>}
      {error && <p className="mt-6 text-center text-red-400">Failed to load: {(error as Error).message}</p>}

      {previouslySeen.length > 0 && (
        <div className="overflow-hidden rounded-b-xl bg-background px-1 pb-2 pt-2 sm:bg-card sm:px-6 sm:pt-6">
          <SectionHeading>Previously seen</SectionHeading>
          <ul className="divide-y divide-border">
            {previouslySeen.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} perspective={perspective} />
            ))}
          </ul>
        </div>
      )}

      {!isLoading && threads.length === 0 && <p className="text-center text-muted-foreground">{emptyMessage}</p>}

      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="py-4 text-center text-sm text-muted-foreground">Loading more...</p>}
      {!hasNextPage && threads.length > 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">That's everything.</p>
      )}
    </div>
  );
}
