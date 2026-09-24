import { describe, expect, it } from 'vitest';
import { buildThreadSummary } from './threadSummary.js';
import type { MailThread } from '../mail-provider/types.js';

function baseThread(overrides: Partial<MailThread> = {}): MailThread {
  return {
    id: 't1',
    snippet: 'hello there',
    labelIds: ['INBOX'],
    messages: [
      {
        id: 'm1',
        threadId: 't1',
        from: { email: 'jane@example.com', name: 'Jane' },
        to: [],
        cc: [],
        subject: 'Hi',
        snippet: 'hello there',
        date: '2026-09-13T10:00:00Z',
        labelIds: ['INBOX'],
        attachments: [],
      },
    ],
    ...overrides,
  };
}

describe('buildThreadSummary', () => {
  it('derives its fields from the last message in the thread', () => {
    const thread = baseThread({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { email: 'old@example.com' },
          to: [],
          cc: [],
          subject: 'Old subject',
          snippet: '',
          date: '2026-09-01T00:00:00Z',
          labelIds: [],
          attachments: [],
        },
        {
          id: 'm2',
          threadId: 't1',
          from: { email: 'newest@example.com' },
          to: [],
          cc: [],
          subject: 'Newest subject',
          snippet: '',
          date: '2026-09-13T00:00:00Z',
          labelIds: [],
          attachments: [],
        },
      ],
    });

    const summary = buildThreadSummary(thread);
    expect(summary.subject).toBe('Newest subject');
    expect(summary.from?.email).toBe('newest@example.com');
    expect(summary.date).toBe('2026-09-13T00:00:00Z');
    expect(summary.messageCount).toBe(2);
  });

  it('carries the last message\'s recipients for the Sent view', () => {
    const thread = baseThread({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { email: 'me@example.com' },
          to: [{ email: 'jane@example.com', name: 'Jane' }],
          cc: [],
          subject: 'Hi',
          snippet: '',
          date: '2026-09-13T00:00:00Z',
          labelIds: ['SENT'],
          attachments: [],
        },
      ],
    });
    expect(buildThreadSummary(thread).to).toEqual([{ email: 'jane@example.com', name: 'Jane' }]);
  });

  it('falls back to "(no subject)" when the subject is empty', () => {
    const thread = baseThread({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { email: 'jane@example.com' },
          to: [],
          cc: [],
          subject: '',
          snippet: '',
          date: '',
          labelIds: [],
          attachments: [],
        },
      ],
    });
    expect(buildThreadSummary(thread).subject).toBe('(no subject)');
  });

  it('marks unread true only when UNREAD is in the label set', () => {
    expect(buildThreadSummary(baseThread({ labelIds: ['INBOX', 'UNREAD'] })).unread).toBe(true);
    expect(buildThreadSummary(baseThread({ labelIds: ['INBOX'] })).unread).toBe(false);
  });

  it('returns undefined from/date when the thread has no messages at all', () => {
    const summary = buildThreadSummary(baseThread({ messages: [] }));
    expect(summary.from).toBeUndefined();
    expect(summary.date).toBeUndefined();
    expect(summary.subject).toBe('(no subject)');
    expect(summary.messageCount).toBe(0);
  });

  it('prefers the last message\'s own snippet over the thread-level one', () => {
    // Gmail leaves the thread-level `snippet` empty for `format=metadata`
    // fetches (what list views use); the per-message snippet is the
    // reliable source and should win whenever it's non-empty.
    const thread = baseThread({
      snippet: 'stale thread-level snippet',
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { email: 'jane@example.com' },
          to: [],
          cc: [],
          subject: 'Hi',
          snippet: 'the real preview text',
          date: '2026-09-13T10:00:00Z',
          labelIds: [],
          attachments: [],
        },
      ],
    });
    expect(buildThreadSummary(thread).snippet).toBe('the real preview text');
  });

  it('falls back to the thread-level snippet when the last message has none', () => {
    const thread = baseThread({
      snippet: 'thread-level fallback',
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { email: 'jane@example.com' },
          to: [],
          cc: [],
          subject: 'Hi',
          snippet: '',
          date: '2026-09-13T10:00:00Z',
          labelIds: [],
          attachments: [],
        },
      ],
    });
    expect(buildThreadSummary(thread).snippet).toBe('thread-level fallback');
  });
});
