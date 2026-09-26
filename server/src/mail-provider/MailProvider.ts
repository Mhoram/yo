import type {
  HistoryChange,
  MailAddress,
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

  getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: string; filename: string }>;

  // Distinct To/Cc addresses from the most recent sent mail, newest first.
  // Powers the compose recipient autocomplete; the contacts cache is seeded
  // from this once (cheap: metadata-only list calls), not per keystroke.
  listSentRecipients(maxResults: number): Promise<MailAddress[]>;

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
