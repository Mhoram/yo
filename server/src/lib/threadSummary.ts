import type { MailThread } from '../mail-provider/types.js';

export interface ThreadSummaryDto {
  id: string;
  snippet: string;
  labelIds: string[];
  from?: { name?: string; email: string };
  to?: { name?: string; email: string }[];
  subject: string;
  date?: string;
  unread: boolean;
  messageCount: number;
}

export function buildThreadSummary(thread: MailThread): ThreadSummaryDto {
  const last = thread.messages.at(-1);
  return {
    id: thread.id,
    // Gmail's thread-level `snippet` comes back empty for `format=metadata`
    // requests (used everywhere list views fetch threads); each message's
    // own `snippet` is populated regardless of format, so prefer that.
    snippet: last?.snippet || thread.snippet,
    labelIds: thread.labelIds,
    from: last?.from,
    to: last?.to,
    // `||`, not `??`: a message with no Subject header parses to an empty
    // string (mimeParser's getHeader), not undefined, so `??` would let a
    // blank subject straight through instead of falling back.
    subject: last?.subject || '(no subject)',
    date: last?.date,
    unread: thread.labelIds.includes('UNREAD'),
    messageCount: thread.messages.length,
  };
}
