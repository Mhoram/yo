import type { MailProvider } from '../mail-provider/MailProvider.js';
import type { HistoryChange, MailAddress, MailLabel, MailThread } from '../mail-provider/types.js';

interface FakeThread {
  id: string;
  snippet: string;
  from: string;
  labelIds: Set<string>;
}

// In-memory MailProvider double for tests; exercises the same interface
// GmailProvider does, so gatekeeperService's logic (gating, approve/block,
// move) is tested against the actual abstraction boundary, not against
// Gmail's real API (which is exactly what MailProvider exists to make
// possible).
export class FakeMailProvider implements MailProvider {
  private labels = new Map<string, string>(); // name -> id
  private nextLabelId = 1;
  private threads = new Map<string, FakeThread>();
  public modifyCalls: { threadId: string; add?: string[]; remove?: string[] }[] = [];

  addThread(thread: { id: string; from: string; snippet?: string; labelIds?: string[] }): void {
    this.threads.set(thread.id, {
      id: thread.id,
      snippet: thread.snippet ?? '',
      from: thread.from,
      labelIds: new Set(thread.labelIds ?? ['INBOX']),
    });
  }

  labelIdFor(name: string): string | undefined {
    return this.labels.get(name);
  }

  threadLabels(threadId: string): string[] {
    return Array.from(this.threads.get(threadId)?.labelIds ?? []);
  }

  getAuthUrl(): string {
    return 'https://fake/auth';
  }

  async handleAuthCallback(): Promise<void> {}

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async listThreadIds(query: {
    label?: string;
    q?: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    let results = Array.from(this.threads.values());

    if (query.label) {
      results = results.filter((t) => t.labelIds.has(query.label!));
    }

    if (query.q) {
      const fromMatch = query.q.match(/from:(\S+)/);
      const labelMatch = query.q.match(/label:(\S+)/);
      if (fromMatch) {
        results = results.filter((t) => t.from === fromMatch[1]);
      }
      if (labelMatch) {
        const labelToken = labelMatch[1];
        const labelId = this.labels.get(labelToken) ?? labelToken;
        results = results.filter(
          (t) => t.labelIds.has(labelId) || t.labelIds.has(labelToken) || t.labelIds.has(labelToken.toUpperCase()),
        );
      }
    }

    return { threadIds: results.map((t) => t.id) };
  }

  async getThread(threadId: string): Promise<MailThread> {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Unknown thread ${threadId}`);
    return {
      id: t.id,
      snippet: t.snippet,
      labelIds: Array.from(t.labelIds),
      messages: [
        {
          id: `${t.id}-msg1`,
          threadId: t.id,
          from: { email: t.from },
          to: [],
          cc: [],
          subject: '',
          snippet: t.snippet,
          date: new Date().toISOString(),
          labelIds: Array.from(t.labelIds),
          attachments: [],
        },
      ],
    };
  }

  async getMessage(): ReturnType<MailProvider['getMessage']> {
    throw new Error('not implemented in FakeMailProvider');
  }

  // Test-seedable; contacts backfill tests can point this at fixtures.
  public sentRecipients: MailAddress[] = [];

  async listSentRecipients(maxResults: number): Promise<MailAddress[]> {
    return this.sentRecipients.slice(0, maxResults);
  }

  async getAttachment(): ReturnType<MailProvider['getAttachment']> {
    throw new Error('not implemented in FakeMailProvider');
  }

  async getHistorySince(historyId: string): Promise<{ changes: HistoryChange[]; newHistoryId: string }> {
    return { changes: [], newHistoryId: historyId };
  }

  async getCurrentHistoryId(): Promise<string> {
    return '1';
  }

  async listLabels(): Promise<MailLabel[]> {
    return Array.from(this.labels.entries()).map(([name, id]) => ({ id, name }));
  }

  async createLabel(name: string): Promise<MailLabel> {
    const id = `Label_${this.nextLabelId++}`;
    this.labels.set(name, id);
    return { id, name };
  }

  async modifyThreadLabels(threadId: string, opts: { add?: string[]; remove?: string[] }): Promise<void> {
    this.modifyCalls.push({ threadId, ...opts });
    const t = this.threads.get(threadId);
    if (!t) return;
    for (const l of opts.remove ?? []) t.labelIds.delete(l);
    for (const l of opts.add ?? []) t.labelIds.add(l);
  }

  async sendMessage(): ReturnType<MailProvider['sendMessage']> {
    throw new Error('not implemented in FakeMailProvider');
  }

  async getMyEmailAddress(): Promise<string> {
    return 'me@example.com';
  }

  async watch(): ReturnType<MailProvider['watch']> {
    throw new Error('not implemented in FakeMailProvider');
  }

  async stopWatch(): Promise<void> {}
}
