export interface MailLabel {
  id: string;
  name: string;
  // Unread counters from Gmail's label objects (present on labels.list;
  // powers the unread badges in the box switcher).
  messagesUnread?: number;
}

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailMessage {
  id: string;
  threadId: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  date: string;
  labelIds: string[];
  attachments: MailAttachmentMeta[];
  // Raw RFC 2822 headers, not Gmail's internal message id; needed to build
  // correct In-Reply-To/References chains so replies thread properly in
  // every mail client, not just Gmail's own UI (which uses its own
  // internal threadId regardless of these headers).
  messageIdHeader?: string;
  referencesHeader?: string;
}

export interface MailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface MailThread {
  id: string;
  snippet: string;
  labelIds: string[];
  messages: MailMessage[];
}

export type HistoryChangeType = 'messageAdded' | 'labelsChanged' | 'messageDeleted';

export interface HistoryChange {
  type: HistoryChangeType;
  threadId: string;
  messageId: string;
}

export interface OutgoingAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

// An address seen while harvesting mailbox headers for the compose
// autocomplete, plus where it was seen: 'sent' (you chose to write to it —
// ranks higher) or 'received' (it appeared in From/To/Cc of your inbox).
export interface HarvestedAddress {
  address: MailAddress;
  source: 'sent' | 'received';
}

export interface OutgoingMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  // RFC Message-ID header value being replied to (not a Gmail internal id),
  // and the accumulated References chain, both needed for proper email
  // threading in any mail client.
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
}
