import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { usePendingSenders } from '../hooks/useGatekeeper';
import { useSearchPreview } from '../hooks/useSearch';
import { Avatar } from './Avatar';
import { BoxMenuButton } from './BoxMenuButton';

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-muted-foreground">
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const DEBOUNCE_MS = 300;

export function NavBar() {
  const { data: pendingData } = usePendingSenders();
  const pendingCount = pendingData?.senders.length ?? 0;
  const location = useLocation();
  const navigate = useNavigate();
  const onSearchPage = location.pathname === '/search';
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onSearchPage) {
      setQuery(new URLSearchParams(location.search).get('q') ?? '');
    }
  }, [onSearchPage, location.search]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDebouncedQuery('');
      return;
    }
    const timeout = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const { data: previewData, isFetching: previewLoading } = useSearchPreview(debouncedQuery);
  const previewThreads = previewData?.threads ?? [];
  const showDropdown = open && debouncedQuery.length > 0;

  function goToThread(id: string) {
    setOpen(false);
    navigate(`/thread/${id}`);
  }

  function submitSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <>
      <nav className="mx-auto flex flex-col gap-3 px-6 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pt-8">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <BoxMenuButton />
          <div className="relative w-full sm:w-auto" ref={containerRef}>
            <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch();
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="Search"
              className="w-full rounded-full border border-border bg-background py-1.5 pl-8 pr-3 text-sm font-normal text-foreground placeholder:text-muted-foreground transition-all focus:outline-none focus:ring-1 focus:ring-primary sm:w-40 sm:focus:w-56"
            />

            {showDropdown && (
              <div className="absolute left-0 top-full z-20 mt-2 w-full rounded-lg border border-border bg-card font-normal shadow-lg sm:w-80">
                {previewLoading && previewThreads.length === 0 && (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
                )}
                {!previewLoading && previewThreads.length === 0 && (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No results for "{debouncedQuery}".</p>
                )}
                {previewThreads.length > 0 && (
                  <ul className="divide-y divide-border">
                    {previewThreads.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => goToThread(thread.id)}
                          className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted"
                        >
                          <Avatar email={thread.from?.email ?? ''} name={thread.from?.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-foreground">{thread.subject}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {thread.from?.name ?? thread.from?.email}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={submitSearch}
                  className="block w-full rounded-b-lg border-t border-border px-4 py-2 text-left text-sm font-semibold text-primary hover:bg-muted"
                >
                  See all results for "{query.trim()}"
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Shown beside each page's own title on mobile instead (see
            ThreadList/Gatekeeper/Search): there's no shared page-title slot
            here in NavBar itself to anchor it next to on narrow screens. */}
        <NavLink
          to="/compose"
          className="hidden shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:block"
        >
          + Write
        </NavLink>
      </nav>
      {pendingCount > 0 && location.pathname !== '/gatekeeper' && (
        <Link
          to="/gatekeeper"
          className="mt-3 block w-full rounded-lg bg-gradient-to-r from-[#39ff14] to-[#00d4ff] px-4 py-3 text-center text-sm font-bold text-[#0b120d] shadow-lg transition-transform hover:scale-[1.01] hover:brightness-110 sm:w-1/4 sm:text-left"
        >
          Screen {pendingCount} first time {pendingCount === 1 ? 'sender' : 'senders'} →
        </Link>
      )}
    </>
  );
}
