import type { MailMessage } from '../mail-provider/types.js';

export interface ReplyEnvelope {
  to: string[];
  cc?: string[];
  subject: string;
  inReplyTo?: string;
  references?: string;
}

// Computes who a reply should actually go to, its subject, and its
// threading headers, pulled out of the route handler specifically so this
// is unit-testable: getting recipients wrong here means a reply silently
// goes to the wrong people.
export function buildReplyEnvelope(lastMessage: MailMessage, myEmail: string, replyAll: boolean): ReplyEnvelope {
  const myEmailLower = myEmail.toLowerCase();
  const originalSenderEmail = lastMessage.from.email.toLowerCase();

  const to = [lastMessage.from.email];
  const cc = new Set<string>();

  if (replyAll) {
    for (const addr of [...lastMessage.to, ...lastMessage.cc]) {
      const email = addr.email.toLowerCase();
      if (email !== myEmailLower && email !== originalSenderEmail) {
        cc.add(addr.email);
      }
    }
  }

  const subject = /^re:/i.test(lastMessage.subject) ? lastMessage.subject : `Re: ${lastMessage.subject}`;
  const references = [lastMessage.referencesHeader, lastMessage.messageIdHeader].filter(Boolean).join(' ');

  return {
    to,
    cc: cc.size > 0 ? Array.from(cc) : undefined,
    subject,
    inReplyTo: lastMessage.messageIdHeader,
    references: references || undefined,
  };
}
