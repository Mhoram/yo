import type { MailAddress, MailMessage } from '../mail-provider/types.js';

// Good-enough plain-text fallback for messages that only have an HTML body
// Not a full HTML-to-text conversion, just enough to make a forwarded
// quote readable.
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatAddress(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

export interface ForwardEnvelope {
  to: string[];
  subject: string;
  bodyText: string;
}

// Forwarding is deliberately a new message, not a reply: no threadId, no
// In-Reply-To/References. It's going to people outside the original
// conversation, so it shouldn't be stitched into that thread.
export function buildForwardEnvelope(originalMessage: MailMessage, to: string[], note?: string): ForwardEnvelope {
  const subject = /^fwd:/i.test(originalMessage.subject) ? originalMessage.subject : `Fwd: ${originalMessage.subject}`;

  const originalBody =
    originalMessage.bodyText ?? (originalMessage.bodyHtml ? stripHtml(originalMessage.bodyHtml) : '');

  const headerLines = [
    '---------- Forwarded message ---------',
    `From: ${formatAddress(originalMessage.from)}`,
    `Date: ${originalMessage.date}`,
    `Subject: ${originalMessage.subject}`,
    `To: ${originalMessage.to.map(formatAddress).join(', ')}`,
  ];
  if (originalMessage.attachments.length > 0) {
    headerLines.push(`Attachments: ${originalMessage.attachments.map((a) => a.filename).join(', ')}`);
  }

  const quoted = [...headerLines, '', originalBody].join('\n');

  const bodyText = note && note.trim().length > 0 ? `${note.trim()}\n\n${quoted}` : quoted;

  return { to, subject, bodyText };
}
