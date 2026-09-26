import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailProvider } from './MailProvider.js';
import type { HistoryChange, MailAddress, MailLabel, MailMessage, MailThread, OutgoingMessage } from './types.js';
import { parseAddressList, parseGmailMessage } from './mimeParser.js';
import { loadTokens, saveTokens } from '../db/oauthTokenStore.js';
import { recordCall } from '../lib/quotaTracker.js';

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
  ): Promise<{ data: Buffer; mimeType: string; filename: string }> {
    // Gmail's attachments.get only returns raw bytes; filename/mimeType
    // live on the message's part metadata, so a full message fetch is
    // needed to identify which part this attachment actually is.
    recordCall('messages.get');
    const msgRes = await this.gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const { message } = parseGmailMessage(msgRes.data);
    const meta = message.attachments.find((a) => a.attachmentId === attachmentId);

    recordCall('messages.attachments.get');
    const attRes = await this.gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
    const data = Buffer.from(attRes.data.data ?? '', 'base64url');

    return {
      data,
      mimeType: meta?.mimeType ?? 'application/octet-stream',
      filename: meta?.filename ?? 'attachment',
    };
  }

  // Metadata-only pages over recent SENT mail (5 quota units/page of 100,
  // not the 50+/thread a full fetch would cost) harvesting To/Cc headers.
  async listSentRecipients(maxResults: number): Promise<MailAddress[]> {
    const seen = new Map<string, MailAddress>();
    let pageToken: string | undefined;

    while (seen.size < maxResults) {
      recordCall('messages.list');
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        labelIds: ['SENT'],
        maxResults: Math.min(100, maxResults - seen.size),
        pageToken,
      });

      for (const m of res.data.messages ?? []) {
        const headers = m.payload?.headers ?? [];
        for (const h of headers) {
          if (h.name?.toLowerCase() !== 'to' && h.name?.toLowerCase() !== 'cc') continue;
          for (const addr of parseAddressList(h.value ?? '')) {
            const key = addr.email.toLowerCase();
            if (!seen.has(key)) seen.set(key, addr);
          }
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }

    return Array.from(seen.values());
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
    return (res.data.labels ?? []).map((l) => ({ id: l.id ?? '', name: l.name ?? '' }));
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
