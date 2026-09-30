import type {
  HarvestedAddress,
  HistoryChange,
  MailLabel,
  MailThread,
  MailMessage,
  MailAttachmentMeta,
  OutgoingMessage,
} from './types.js';

export interface MailProvider {
  getAuthUrl(): string;
  handleAuthCallback(code: string): Promise<void>;
  isAuthenticated(): Promise<boolean>;

  listThreadIds(query: { label?: string; q?: string; pageToken?: string; maxResults?: number }): Promise<{
    threadIds: string[];
    nextPageToken?: string;
  }>;
  // opts.full=false fetches headers/snippet only (cheap, for list views);
  // full=true (default) fetches bodies/attachments too (for reading a thread).
  getThread(threadId: string, opts?: { full?: boolean }): Promise<MailThread>;

  getMessage(messageId: string): Promise<MailMessage>;

  // attachmentId comes from a cached thread fetch. Gmail rotates attachment
  // IDs on every messages.get (encrypted-ID era), so the ID is only good for
  // fetching bytes — to get the part's REAL metadata, pass partIndex, the
  // attachment's position in the parsed message.attachments array (stable:
  // the walk is structural), and the provider re-resolves it server-side.
  getAttachment(
    messageId: string,
    attachmentId: string,
    opts?: { partIndex?: number },
  ): Promise<{ data: Buffer; mimeType: string; filename: string }>;

  // Distinct addresses from mail headers (sent + received), for seeding the
  // compose recipient autocomplete. Bounded per call; the route resumes with
  // the returned pageToken on later runs until nextPageToken comes back
  // undefined (whole mailbox covered). onPageToken fires after every
  // completed page so the route can persist the cursor incrementally — a
  // restart then loses at most one page, not the batch.
  listRecentAddresses(opts?: {
    maxMessages?: number;
    pageToken?: string;
    onPageToken?: (pageToken: string) => void;
  }): Promise<{ addresses: HarvestedAddress[]; nextPageToken?: string }>;

  getHistorySince(historyId: string): Promise<{ changes: HistoryChange[]; newHistoryId: string }>;
  getCurrentHistoryId(): Promise<string>;

  listLabels(): Promise<MailLabel[]>;
  createLabel(name: string): Promise<MailLabel>;
  modifyThreadLabels(threadId: string, opts: { add?: string[]; remove?: string[] }): Promise<void>;

  sendMessage(msg: OutgoingMessage): Promise<{ messageId: string; threadId: string }>;
  getMyEmailAddress(): Promise<string>;

  watch(opts: { topicName: string; labelIds?: string[] }): Promise<{ historyId: string; expiration: string }>;
  stopWatch(): Promise<void>;
}

export type { MailAttachmentMeta };
