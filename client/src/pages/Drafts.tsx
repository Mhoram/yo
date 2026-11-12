import { Link, useNavigate } from 'react-router-dom';
import { useDrafts, useDeleteDraft } from '../hooks/useDrafts';
import { NavBar } from '../components/NavBar';
import { formatDateTime } from '../lib/format';
import type { Draft } from '../lib/api';

const KIND_LABELS: Record<Draft['kind'], string> = {
  compose: 'New email',
  reply: 'Reply',
  forward: 'Forward',
};

function draftTarget(draft: Draft): string {
  // Reply/forward drafts reopen in their thread's compose box; compose
  // drafts reopen in the Write page.
  return draft.kind === 'compose' ? `/compose?draft=${draft.id}` : `/thread/${draft.threadId}?draft=${draft.id}`;
}

// Lists every saved draft. Rows show what the draft is (kind + first
// destination), since subjects are often still empty mid-thought.
export function Drafts() {
  const { data: drafts, isLoading, error } = useDrafts();
  const deleteDraft = useDeleteDraft();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10 sm:px-6">
      <NavBar />
      <h1 className="mb-8 mt-6 text-center text-4xl font-bold">Drafts</h1>

      {isLoading && <p className="mt-6 text-center text-muted-foreground">Loading...</p>}
      {error && <p className="mt-6 text-center text-red-400">Failed to load: {(error as Error).message}</p>}

      {drafts && drafts.length === 0 && (
        <p className="mt-6 text-center text-muted-foreground">No drafts. Unfinished mail saves itself as you type.</p>
      )}

      {drafts && drafts.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card">
          {drafts.map((draft) => (
            <li key={draft.id} className="flex items-center gap-3 p-4">
              <button
                type="button"
                onClick={() => navigate(draftTarget(draft))}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-semibold text-foreground">
                  {draft.subject.trim().length > 0 ? draft.subject : '(no subject)'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {KIND_LABELS[draft.kind]}
                  {draft.to.trim().length > 0 && ` · to ${draft.to.trim()}`}
                  {' · '}
                  {formatDateTime(draft.updatedAt)}
                </p>
              </button>
              <button
                type="button"
                onClick={() => deleteDraft.mutate(draft.id)}
                disabled={deleteDraft.isPending}
                className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Anything you start in <Link to="/compose" className="text-primary hover:underline">Write</Link> or a reply/forward
        box saves itself here after a couple of seconds.
      </p>
    </div>
  );
}
