import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { usePendingSenders } from '../hooks/useGatekeeper';
import { useBoxes } from '../hooks/useBoxes';
import { useDrafts } from '../hooks/useDrafts';
import { ThemeMenuItem } from './ThemeToggle';

const menuLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-semibold ${
    isActive ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

// The launcher for switching between Yobox/Receipts/Feed/Sent/Gatekeeper.
// anchored at the top as a compact dropdown on desktop, but pinned to the
// bottom center on mobile instead of a top corner, since that's the reachable
// spot for a thumb on a phone.
export function BoxMenuButton() {
  const { data } = usePendingSenders();
  const pendingCount = data?.senders.length ?? 0;
  const boxes = useBoxes().data;
  const draftCount = useDrafts().data?.length ?? 0;
  // e.g. "Yobox (3)", or "Feed (99+)" when the week's unread runs past
  // the server's cap.
  const unreadLabel = (key: 'yobox' | 'receipts' | 'feed') => {
    const box = boxes?.find((b) => b.key === key);
    if (!box || box.unread === 0) return '';
    return ` (${box.unread}${box.unreadCapped ? '+' : ''})`;
  };
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  function close() {
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch inbox"
        aria-expanded={open}
        className="fixed bottom-2.5 left-1/2 z-30 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-card shadow-lg ring-1 ring-border sm:static sm:h-[52px] sm:w-[52px] sm:translate-x-0 sm:bg-transparent sm:shadow-none sm:ring-0 sm:hover:bg-muted"
      >
        <img src="/favicon.svg?v=3" alt="yo" className="h-[42px] w-[42px] sm:h-[30px] sm:w-[30px]" />
      </button>

      {open && (
        <>
          {/* Dimmed backdrop, mobile only. Desktop's dropdown closes on
              outside click (see the mousedown listener above) without
              needing to dim the whole page, matching the existing search
              dropdown's convention. */}
          <div className="fixed inset-0 z-20 bg-black/40 sm:hidden" onClick={close} />
          <div className="fixed inset-x-4 bottom-[84px] z-20 mx-auto w-auto max-w-xs rounded-xl border border-border bg-card p-1.5 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-48 sm:max-w-none">
            <NavLink to="/" end className={menuLinkClass} onClick={close}>
              Yobox{unreadLabel('yobox')}
            </NavLink>
            <NavLink to="/receipts" className={menuLinkClass} onClick={close}>
              Receipts{unreadLabel('receipts')}
            </NavLink>
            <NavLink to="/feed" className={menuLinkClass} onClick={close}>
              Feed{unreadLabel('feed')}
            </NavLink>
            <NavLink to="/drafts" className={menuLinkClass} onClick={close}>
              Drafts{draftCount > 0 && ` (${draftCount})`}
            </NavLink>
            <NavLink to="/sent" className={menuLinkClass} onClick={close}>
              Sent
            </NavLink>
            <NavLink to="/gatekeeper" className={menuLinkClass} onClick={close}>
              Gatekeeper{pendingCount > 0 && ` (${pendingCount})`}
            </NavLink>
            {/* Theme switch rides along in the popup on mobile — thumb-reachable
                next to the box nav, instead of a cramped icon up top. The
                desktop nav has its own compact toggle. */}
            <div className="mt-1 border-t border-border pt-1 sm:hidden">
              <ThemeMenuItem />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
