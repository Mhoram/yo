import { Link } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { useBlockedSenders, usePendingSenders, useGatekeeperDecision } from '../hooks/useGatekeeper';
import type { BlockedSender } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { formatListDate } from '../lib/format';

export function Gatekeeper() {
  const { data, isLoading, error } = usePendingSenders();
  const decision = useGatekeeperDecision();
  const blocked = useBlockedSenders();

  return (
    <div className="mx-auto max-w-5xl px-2 pb-10 sm:px-6">
      <NavBar />
      <div className="mb-8 mt-6 flex items-center justify-between gap-3 sm:block">
        <h1 className="text-left text-4xl font-bold sm:text-center">Gatekeeper</h1>
        <Link
          to="/compose"
          className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:hidden"
        >
          + Write
        </Link>
      </div>

      {isLoading && <p className="text-center text-muted-foreground">Loading...</p>}
      {error && <p className="text-center text-red-400">Failed to load: {(error as Error).message}</p>}

      <ul className="divide-y divide-border">
        {data?.senders.map((sender) => (
          <SenderRow
            key={sender.email}
            sender={sender}
            metaLabel={`${sender.heldCount} ${sender.heldCount === 1 ? 'message' : 'messages'} held since ${formatListDate(sender.firstSeenAt)}`}
          >
            <span className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ email: sender.email, action: 'approve', bucket: 'yobox' })}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Yobox
              </button>
              <button
                type="button"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ email: sender.email, action: 'approve', bucket: 'receipts' })}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Receipts
              </button>
              <button
                type="button"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ email: sender.email, action: 'approve', bucket: 'feed' })}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Feed
              </button>
              <button
                type="button"
                disabled={decision.isPending}
                onClick={() => decision.mutate({ email: sender.email, action: 'block' })}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                No, keep out
              </button>
            </span>
          </SenderRow>
        ))}
      </ul>

      {data?.senders.length === 0 && <p className="text-center text-muted-foreground">No one waiting.</p>}

      <h2 className="mb-2 mt-12 text-center text-xl font-bold">
        All the emails from people you've screened out. These will be automatically deleted after 90 days.
      </h2>

      {blocked.isLoading && <p className="text-center text-muted-foreground">Loading...</p>}
      {blocked.error && (
        <p className="text-center text-red-400">Failed to load: {(blocked.error as Error).message}</p>
      )}

      <ul className="divide-y divide-border">
        {blocked.data?.senders.map((sender) => (
          <BlockedSenderRow key={sender.email} sender={sender} />
        ))}
      </ul>

      {blocked.data?.senders.length === 0 && (
        <p className="text-center text-muted-foreground">No one screened out.</p>
      )}
    </div>
  );
}

function BlockedSenderRow({ sender }: { sender: BlockedSender }) {
  return (
    <SenderRow
      sender={sender}
      metaLabel={
        sender.decidedAt
          ? `${sender.heldCount} ${sender.heldCount === 1 ? 'message' : 'messages'} screened out ${formatListDate(sender.decidedAt)}`
          : `${sender.heldCount} ${sender.heldCount === 1 ? 'message' : 'messages'}`
      }
    />
  );
}

function SenderRow({
  sender,
  metaLabel,
  children,
}: {
  sender: { email: string; displayName: string | null; snippet: string | null; threadId: string | null };
  metaLabel: string;
  children?: React.ReactNode;
}) {
  const info = (
    <>
      <Avatar email={sender.email} name={sender.displayName ?? undefined} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-semibold">{sender.displayName ?? sender.email}</span>
        <span className="block truncate text-base text-muted-foreground">
          {sender.email}
          {sender.snippet && <> · {sender.snippet}</>}
        </span>
        <span className="text-sm text-muted-foreground">{metaLabel}</span>
      </span>
    </>
  );

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      {sender.threadId ? (
        <Link to={`/thread/${sender.threadId}`} className="flex min-w-0 flex-1 items-start gap-4 hover:opacity-80">
          {info}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-4">{info}</span>
      )}
      {children}
    </li>
  );
}
