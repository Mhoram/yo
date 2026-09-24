import { Link } from 'react-router-dom';
import { formatListDate } from '../lib/format';
import { Avatar } from './Avatar';
import type { ThreadSummary } from '../lib/api';

// In the Sent view every message is *from* you, so the useful counterparty
// to show/avatar-by is the recipient instead; everywhere else it's the
// sender, as usual.
function recipientLabel(to: ThreadSummary['to']): string {
  if (!to || to.length === 0) return '(no recipient)';
  const [first, ...rest] = to;
  const firstLabel = first.name ?? first.email;
  return rest.length > 0 ? `${firstLabel} +${rest.length}` : firstLabel;
}

export function ThreadRow({ thread, perspective = 'received' }: { thread: ThreadSummary; perspective?: 'received' | 'sent' }) {
  const sent = perspective === 'sent';
  const avatarEmail = sent ? (thread.to?.[0]?.email ?? '') : (thread.from?.email ?? '');
  const avatarName = sent ? thread.to?.[0]?.name : thread.from?.name;
  const counterpartyLabel = sent ? recipientLabel(thread.to) : (thread.from?.name ?? thread.from?.email);

  return (
    <li>
      <Link to={`/thread/${thread.id}`} className="flex items-center gap-3 py-4 pr-4 hover:bg-foreground/5">
        <span className="flex items-center gap-1 sm:gap-3">
          <span className="flex h-1.5 w-1.5 shrink-0 items-center justify-center sm:h-auto sm:w-3 sm:self-stretch">
            {thread.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-unread-dot sm:h-2.5 sm:w-2.5" />}
          </span>
          <Avatar
            email={avatarEmail}
            name={avatarName}
            boxClassName="h-[2.4rem] w-[2.4rem] sm:h-12 sm:w-12"
            textClassName="text-sm sm:text-base"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9rem] font-semibold sm:text-lg">{thread.subject}</span>
          <span className="block truncate text-[0.8rem] text-muted-foreground sm:text-base">
            {sent ? `To: ${counterpartyLabel}` : counterpartyLabel}
          </span>
          {thread.snippet && (
            <span className="block truncate text-[0.8rem] text-muted-foreground sm:text-base">{thread.snippet}</span>
          )}
        </span>
        {thread.date && (
          <span className="shrink-0 self-start text-[0.7rem] text-muted-foreground sm:self-auto sm:text-sm">
            {formatListDate(thread.date)}
          </span>
        )}
      </Link>
    </li>
  );
}
