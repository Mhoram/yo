import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailProvider } from './MailProvider.js';
import type {
  HarvestedAddress,
  HistoryChange,
  MailLabel,
  MailMessage,
  MailThread,
  OutgoingMessage,
} from './types.js';
import { parseAddressList, parseGmailMessage } from './mimeParser.js';
import { loadTokens, saveTokens } from '../db/oauthTokenStore.js';
import { recordCall } from '../lib/quotaTracker.js';
import { mapWithConcurrency } from '../lib/concurrency.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

export class GmailProvider implements MailProvider {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private cachedEmailAddress: string | undefined;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const existing = loadTokens();
    if (existing) {
      this.oauth2Client.setCredentials({
        access_token: existing.access_token,
        refresh_token: existing.refresh_token,
        expiry_date: existing.expiry_date,
        scope: existing.scope,
        token_type: existing.token_type,
      });
    }

    this.oauth2Client.on('tokens', (tokens) => {
      const current = loadTokens();
      if (!current && !tokens.refresh_token) return;
      saveTokens({
        access_token: tokens.access_token ?? current?.access_token ?? '',
        refresh_token: tokens.refresh_token ?? current?.refresh_token ?? '',
        expiry_date: tokens.expiry_date ?? current?.expiry_date ?? 0,
        scope: tokens.scope ?? current?.scope,
        token_type: tokens.token_type ?? current?.token_type,
      });
    });
  }

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
  }

  async handleAuthCallback(code: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    if (!tokens.refresh_token) {
      const existing = loadTokens();
      if (!existing) {
        throw new Error(
          'Google did not return a refresh token. Revoke app access at https://myaccount.google.com/permissions and try again so Google issues a fresh one.',
        );
      }
    }
    saveTokens({
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token ?? loadTokens()?.refresh_token ?? '',
      expiry_date: tokens.expiry_date ?? 0,
      scope: tokens.scope ?? undefined,
      token_type: tokens.token_type ?? undefined,
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return loadTokens() !== undefined;
  }

  async listThreadIds(query: {
    label?: string;
    q?: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    recordCall('threads.list');
    const res = await this.gmail.users.threads.list({
      userId: 'me',
      labelIds: query.label ? [query.label] : undefined,
      q: query.q,
      pageToken: query.pageToken,
      maxResults: query.maxResults ?? 25,
    });
    return {
      threadIds: (res.data.threads ?? []).map((t) => t.id ?? '').filter(Boolean),
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  }

  async getThread(threadId: string, opts?: { full?: boolean }): Promise<MailThread> {
    const full = opts?.full ?? true;
    recordCall('threads.get');
    const res = await this.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: full ? 'full' : 'metadata',
      metadataHeaders: full ? undefined : ['From', 'To', 'Subject', 'Date'],
    });
    const messages = await Promise.all(
      (res.data.messages ?? []).map(async (raw) => {
        const { message, inlineImages } = parseGmailMessage(raw);
        return full ? this.resolveInlineImages(message, inlineImages) : message;
      }),
    );
    return {
      id: res.data.id ?? threadId,
      snippet: res.data.snippet ?? '',
      labelIds: messages.at(-1)?.labelIds ?? [],
      messages,
    };
  }

  async getMessage(messageId: string) {
    recordCall('messages.get');
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    const { message, inlineImages } = parseGmailMessage(res.data);
    return this.resolveInlineImages(message, inlineImages);
  }

  // Gmail HTML emails reference embedded images as `cid:xxx`; the browser
  // can't fetch those, so swap each reference for a data: URI fetched from
  // the Gmail attachment endpoint before the body ever reaches sanitization.
  private async resolveInlineImages(
    message: MailMessage,
    inlineImages: Map<string, { attachmentId: string; mimeType: string }>,
  ): Promise<MailMessage> {
    if (!message.bodyHtml || !message.bodyHtml.includes('cid:') || inlineImages.size === 0) {
      return message;
    }

    const referencedCids = new Set(
      Array.from(message.bodyHtml.matchAll(/cid:([^"'\s)]+)/g)).map((m) => m[1]),
    );

    let bodyHtml = message.bodyHtml;
    let resolvedCount = 0;
    for (const cid of referencedCids) {
      if (resolvedCount >= 20) break;
      const ref = inlineImages.get(cid);
      if (!ref) continue;

      recordCall('messages.attachments.get');
      const attachment = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: message.id,
        id: ref.attachmentId,
      });
      if (!attachment.data.data) continue;

      const bytes = Buffer.from(attachment.data.data, 'base64url');
      const dataUri = `data:${ref.mimeType};base64,${bytes.toString('base64')}`;
      bodyHtml = bodyHtml.split(`cid:${cid}`).join(dataUri);
      resolvedCount += 1;
    }

    return { ...message, bodyHtml };
  }

  async getAttachment(
    messageId: string,
    attachmentId: string,
    opts?: { partIndex?: number },
  ): Promise<{ data: Buffer; mimeType: string; filename: string }> {
    // Gmail's attachments.get only returns raw bytes; filename/mimeType
    // live on the message's part metadata, so a full message fetch is
    // needed to identify which part this attachment actually is.
    recordCall('messages.get');
    const msgRes = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const { message } = parseGmailMessage(msgRes.data);
    // Gmail rotates attachment IDs on every messages.get, so a cached ID
    // never matches the fresh fetch. The attachments array is in stable
    // structural walk order, so partIndex is the reliable address; the ID
    // match is kept as a fallback for callers that don't pass an index.
    const meta =
      (opts?.partIndex != null ? message.attachments[opts.partIndex] : undefined) ??
      message.attachments.find((a) => a.attachmentId === attachmentId);

    recordCall('messages.attachments.get');
    const attRes = await this.gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
    const data = Buffer.from(attRes.data.data ?? '', 'base64url');

    return {
      data,
      mimeType: meta?.mimeType ?? 'application/octet-stream',
      filename: meta?.filename ?? 'attachment',
    };
  }

  // Harvests address headers (From/To/Cc) for the compose autocomplete.
  // messages.list does NOT return headers (only ids/labels), so this lists
  // ids cheaply then fetches each message metadata-only — 20 quota units
  // each, so the sweep paces itself well under Google's 250 units/min/user
  // limit and must run in the background, never blocking a request. Sent
  // mail is swept first (its addresses rank higher as things you chose to
  // write to), then all mail for people who have written to you; an address
  // seen in both keeps the 'sent' source. All-mail rather than INBOX-only
  // because yo's gatekeeper strips INBOX from approved mail into its own
  // bucket labels — an INBOX sweep would mostly miss regular correspondents
  // on an actively-used install.
  //
  // Bounded by maxMessages and resumable: the route feeds back nextPageToken
  // on later runs until the whole mailbox has been swept.
  async listRecentAddresses(
    opts?: { maxMessages?: number; pageToken?: string; onPageToken?: (pageToken: string) => void },
  ): Promise<{ addresses: HarvestedAddress[]; nextPageToken?: string }> {
    const maxMessages = opts?.maxMessages ?? 1000;
    const seen = new Map<string, HarvestedAddress>();
    let scanned = 0;

    // Rolling-window pace limiter: at most GETS_PER_MIN messages.get calls
    // per 60s. messages.get costs 5 quota units (metadata format included),
    // so 40/min ≈ 200 units/min against Google's 250 units/min/user cap —
    // full-speed concurrency was observed to 429 in seconds, and this still
    // leaves headroom for interactive calls sharing the same window.
    const GETS_PER_MIN = 40;
    const getTimes: number[] = [];
    const pace = async () => {
      const now = Date.now();
      while (getTimes.length > 0 && now - getTimes[0] > 60_000) getTimes.shift();
      if (getTimes.length >= GETS_PER_MIN) {
        const waitMs = 60_000 - (now - getTimes[0]) + 100;
        await new Promise((r) => setTimeout(r, waitMs));
      }
      getTimes.push(Date.now());
    };

    // persist: only the all-mail sweep's cursor is resumable. The sent
    // sweep is capped and cheap, so it's effectively atomic — its page
    // tokens are scoped to the SENT query and must never be fed back into
    // the all-mail sweep after a restart (Google rejects foreign tokens).
    const sweep = async (
      labelIds: string[] | undefined,
      keepSpamTrash: boolean,
      startToken: string | undefined,
      pageCap: number,
      persist = false,
    ): Promise<string | undefined> => {
      let pageToken = startToken;
      let pages = 0;
      while (pages < pageCap && scanned < maxMessages) {
        recordCall('messages.list');
        const res = await this.gmail.users.messages.list({
          userId: 'me',
          labelIds,
          // Keep spam/trash out of the address book.
          q: keepSpamTrash ? undefined : '-in:spam -in:trash',
          maxResults: Math.min(100, maxMessages - scanned),
          pageToken,
        });
        const msgs = res.data.messages ?? [];
        pages += 1;
        pageToken = res.data.nextPageToken ?? undefined;
        if (msgs.length === 0) break;

        for (const m of msgs) {
          if (scanned >= maxMessages) break;
          await pace();
          recordCall('messages.get');
          const full = await this.gmail.users.messages.get({
            userId: 'me',
            id: m.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc'],
          });
          scanned += 1;
          const source: HarvestedAddress['source'] = full.data.labelIds?.includes('SENT') ? 'sent' : 'received';
          for (const h of full.data.payload?.headers ?? []) {
            const name = h.name?.toLowerCase();
            if (name !== 'from' && name !== 'to' && name !== 'cc') continue;
            for (const addr of parseAddressList(h.value ?? '')) {
              const key = addr.email.toLowerCase();
              if (!seen.has(key)) seen.set(key, { address: addr, source });
            }
          }
        }

        // Persist the cursor after every page so a mid-batch restart
        // resumes from the last completed page instead of losing the run.
        if (pageToken && persist) opts?.onPageToken?.(pageToken);

        if (!pageToken) break;
      }
      return pageToken;
    };

    // Resuming a prior run: the sent sweep already happened, continue the
    // all-mail sweep from the stored cursor.
    if (opts?.pageToken) {
      const token = await sweep(undefined, false, opts.pageToken, Math.ceil(maxMessages / 100), true);
      return { addresses: Array.from(seen.values()), nextPageToken: token };
    }

    await sweep(['SENT'], true, undefined, 10);
    const token = await sweep(undefined, false, undefined, Math.ceil(maxMessages / 100), true);
    return { addresses: Array.from(seen.values()), nextPageToken: token };
  }

  async getHistorySince(historyId: string): Promise<{ changes: HistoryChange[]; newHistoryId: string }> {
    recordCall('history.list');
    const res = await this.gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
    });
    const changes: HistoryChange[] = [];
    for (const h of res.data.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        changes.push({ type: 'messageAdded', threadId: m.message?.threadId ?? '', messageId: m.message?.id ?? '' });
      }
      for (const m of h.labelsAdded ?? []) {
        changes.push({ type: 'labelsChanged', threadId: m.message?.threadId ?? '', messageId: m.message?.id ?? '' });
      }
      for (const m of h.labelsRemoved ?? []) {
        changes.push({ type: 'labelsChanged', threadId: m.message?.threadId ?? '', messageId: m.message?.id ?? '' });
      }
    }
    return { changes, newHistoryId: res.data.historyId ?? historyId };
  }

  async getCurrentHistoryId(): Promise<string> {
    recordCall('getProfile');
    const res = await this.gmail.users.getProfile({ userId: 'me' });
    return res.data.historyId ?? '';
  }

  async listLabels(): Promise<MailLabel[]> {
    recordCall('labels.list');
    const res = await this.gmail.users.labels.list({ userId: 'me' });
    return (res.data.labels ?? []).map((l) => ({
      id: l.id ?? '',
      name: l.name ?? '',
    }));
  }

  async createLabel(name: string): Promise<MailLabel> {
    recordCall('labels.create');
    const res = await this.gmail.users.labels.create({
      userId: 'me',
      requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    return { id: res.data.id ?? '', name: res.data.name ?? name };
  }

  async modifyThreadLabels(threadId: string, opts: { add?: string[]; remove?: string[] }): Promise<void> {
    recordCall('threads.modify');
    await this.gmail.users.threads.modify({
      userId: 'me',
      id: threadId,
      requestBody: { addLabelIds: opts.add, removeLabelIds: opts.remove },
    });
  }

  async sendMessage(msg: OutgoingMessage): Promise<{ messageId: string; threadId: string }> {
    const composer = new MailComposer({
      to: msg.to.join(', '),
      cc: msg.cc && msg.cc.length > 0 ? msg.cc.join(', ') : undefined,
      bcc: msg.bcc && msg.bcc.length > 0 ? msg.bcc.join(', ') : undefined,
      subject: msg.subject,
      text: msg.bodyText,
      html: msg.bodyHtml,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, 'base64'),
        contentType: a.contentType,
      })),
    });
    const buffer = await composer.compile().build();
    const raw = buffer.toString('base64url');

    recordCall('messages.send');
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: msg.threadId },
    });

    return { messageId: res.data.id ?? '', threadId: res.data.threadId ?? msg.threadId ?? '' };
  }

  async getMyEmailAddress(): Promise<string> {
    if (this.cachedEmailAddress) return this.cachedEmailAddress;
    recordCall('getProfile');
    const res = await this.gmail.users.getProfile({ userId: 'me' });
    this.cachedEmailAddress = res.data.emailAddress ?? '';
    return this.cachedEmailAddress;
  }

  async watch(): Promise<{ historyId: string; expiration: string }> {
    throw new Error('watch (Gmail Pub/Sub push) is not implemented yet; v1 uses polling');
  }

  async stopWatch(): Promise<void> {
    throw new Error('watch (Gmail Pub/Sub push) is not implemented yet; v1 uses polling');
  }
}
