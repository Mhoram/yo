import type {
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
  getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: string; filename: string }>;

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
