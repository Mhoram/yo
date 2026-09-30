export interface ThreadSummary {
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

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface MailMessage {
  id: string;
  threadId: string;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  date: string;
  labelIds: string[];
  attachments: MailAttachmentMeta[];
}

export interface MailThread {
  id: string;
  snippet: string;
  labelIds: string[];
  messages: MailMessage[];
}

export interface PendingSender {
  email: string;
  displayName: string | null;
  snippet: string | null;
  heldCount: number;
  firstSeenAt: string;
  threadId: string | null;
}

export interface BlockedSender {
  email: string;
  displayName: string | null;
  snippet: string | null;
  heldCount: number;
  decidedAt: string | null;
  threadId: string | null;
}

export type ApprovalBucket = 'yobox' | 'receipts' | 'feed';

export interface KnownContact {
  email: string;
  name: string | null;
}

export interface MailBox {
  key: 'yobox' | 'receipts' | 'feed';
  unread: number;
}

export interface OutgoingAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  authStatus: () => request<{ authenticated: boolean }>('/auth/status'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  listThreads: (label = 'INBOX', pageToken?: string) =>
    request<{ threads: ThreadSummary[]; nextPageToken?: string }>(
      `/api/threads?label=${encodeURIComponent(label)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    ),
  getThread: (id: string) => request<MailThread>(`/api/threads/${id}`),
  listPendingSenders: () => request<{ senders: PendingSender[] }>('/api/gatekeeper'),
  listBlockedSenders: () => request<{ senders: BlockedSender[] }>('/api/gatekeeper/blocked'),
  approveSender: (email: string, bucket: ApprovalBucket = 'yobox') =>
    request<void>(`/api/gatekeeper/${encodeURIComponent(email)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket }),
    }),
  blockSender: (email: string) => request<void>(`/api/gatekeeper/${encodeURIComponent(email)}/block`, { method: 'POST' }),
  getSenderLogo: (email: string) =>
    request<{ logoUrl: string | null }>(`/api/senders/${encodeURIComponent(email)}/logo`),
  moveSenderBucket: (email: string, bucket: ApprovalBucket) =>
    request<{ movedThreadIds: string[] }>(`/api/senders/${encodeURIComponent(email)}/bucket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket }),
    }),
  markThreadsSeen: (ids: string[]) =>
    request<{ markedThreadIds: string[] }>('/api/threads/mark-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),
  archiveThread: (id: string) => request<void>(`/api/threads/${id}/archive`, { method: 'POST' }),
  trashThread: (id: string) => request<void>(`/api/threads/${id}/trash`, { method: 'POST' }),
  markThreadUnread: (id: string) => request<void>(`/api/threads/${id}/unread`, { method: 'POST' }),
  replyToThread: (
    threadId: string,
    opts: { bodyText: string; bodyHtml?: string; replyAll?: boolean; attachments?: OutgoingAttachment[] },
  ) =>
    request<{ messageId: string; threadId: string }>(`/api/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  forwardThread: (threadId: string, opts: { to: string[]; note?: string; attachments?: OutgoingAttachment[] }) =>
    request<{ messageId: string; threadId: string }>(`/api/threads/${threadId}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  listContacts: () => request<{ contacts: KnownContact[] }>('/api/contacts'),
  listBoxes: () => request<{ boxes: MailBox[] }>('/api/boxes'),
  composeMessage: (opts: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    attachments?: OutgoingAttachment[];
  }) =>
    request<{ messageId: string; threadId: string }>('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  searchThreads: (q: string, pageToken?: string, limit?: number) =>
    request<{ threads: ThreadSummary[]; nextPageToken?: string }>(
      `/api/search?q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}${limit ? `&limit=${limit}` : ''}`,
    ),
};
