import type { gmail_v1 } from 'googleapis';
import type { MailAddress, MailAttachmentMeta, MailMessage } from './types.js';

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function parseAddress(raw: string): MailAddress {
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return { name: name.length > 0 ? name : undefined, email: match[2].trim().toLowerCase() };
  }
  return { email: raw.trim().toLowerCase() };
}

// A plain `raw.split(',')` breaks on a quoted display name that itself
// contains a comma (e.g. `"Doe, Jane" <jane@example.com>, bob@example.com`,
// a real header shape Outlook/Exchange commonly produces); split only on
// commas outside double quotes instead.
export function splitAddressList(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) parts.push(current);

  return parts;
}

export function parseAddressList(raw: string): MailAddress[] {
  if (!raw) return [];
  return splitAddressList(raw)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseAddress(part));
}

export interface InlineImageRef {
  attachmentId: string;
  mimeType: string;
}

interface WalkResult {
  bodyHtml?: string;
  bodyText?: string;
  attachments: MailAttachmentMeta[];
  inlineImages: Map<string, InlineImageRef>;
}

function walkParts(part: gmail_v1.Schema$MessagePart | undefined, result: WalkResult): void {
  if (!part) return;

  const contentId = getHeader(part.headers, 'Content-ID').replace(/^<|>$/g, '');
  if (contentId && part.body?.attachmentId) {
    result.inlineImages.set(contentId, {
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType ?? 'application/octet-stream',
    });
  }

  // A text/* part with a filename is still a body, not an attachment —
  // Outlook/Exchange name their body parts (`Content-Disposition: inline;
  // filename="body.html"`), and burying it in attachments loses the message
  // body entirely. Only a text part explicitly marked Content-Disposition:
  // attachment (an attached .txt file) counts as an attachment.
  const mimeType = part.mimeType ?? '';
  const disposition = getHeader(part.headers, 'Content-Disposition').toLowerCase();
  const isInlineText = mimeType.startsWith('text/') && !disposition.includes('attachment');

  if (part.filename && part.filename.length > 0 && part.body?.attachmentId && !isInlineText) {
    result.attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body.size ?? 0,
    });
    return;
  }

  if (part.mimeType === 'text/html' && part.body?.data && !result.bodyHtml) {
    result.bodyHtml = decodeBase64Url(part.body.data);
  } else if (part.mimeType === 'text/plain' && part.body?.data && !result.bodyText) {
    result.bodyText = decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    walkParts(child, result);
  }
}

export interface ParsedGmailMessage {
  message: MailMessage;
  inlineImages: Map<string, InlineImageRef>;
}

export function parseGmailMessage(msg: gmail_v1.Schema$Message): ParsedGmailMessage {
  const headers = msg.payload?.headers;
  const result: WalkResult = { attachments: [], inlineImages: new Map() };
  walkParts(msg.payload ?? undefined, result);

  const message: MailMessage = {
    id: msg.id ?? '',
    threadId: msg.threadId ?? '',
    from: parseAddress(getHeader(headers, 'From')),
    to: parseAddressList(getHeader(headers, 'To')),
    cc: parseAddressList(getHeader(headers, 'Cc')),
    subject: getHeader(headers, 'Subject'),
    snippet: msg.snippet ?? '',
    bodyHtml: result.bodyHtml,
    bodyText: result.bodyText,
    date: getHeader(headers, 'Date'),
    labelIds: msg.labelIds ?? [],
    attachments: result.attachments,
    messageIdHeader: getHeader(headers, 'Message-ID') || undefined,
    referencesHeader: getHeader(headers, 'References') || undefined,
  };

  return { message, inlineImages: result.inlineImages };
}
