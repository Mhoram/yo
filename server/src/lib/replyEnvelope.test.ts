import { describe, expect, it } from 'vitest';
import { buildReplyEnvelope } from './replyEnvelope.js';
import type { MailMessage } from '../mail-provider/types.js';

function baseMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'm1',
    threadId: 't1',
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [{ email: 'me@example.com' }],
    cc: [],
    subject: 'Project update',
    snippet: '',
    date: '',
    labelIds: [],
    attachments: [],
    ...overrides,
  };
}

describe('buildReplyEnvelope', () => {
  it('replies only to the sender when replyAll is false', () => {
    const envelope = buildReplyEnvelope(
      baseMessage({ to: [{ email: 'me@example.com' }, { email: 'other@example.com' }] }),
      'me@example.com',
      false,
    );
    expect(envelope.to).toEqual(['sender@example.com']);
    expect(envelope.cc).toBeUndefined();
  });

  it('cc\'s the rest of To/Cc when replyAll is true, excluding self and the original sender', () => {
    const message = baseMessage({
      to: [{ email: 'me@example.com' }, { email: 'colleague@example.com' }],
      cc: [{ email: 'watcher@example.com' }],
    });
    const envelope = buildReplyEnvelope(message, 'me@example.com', true);
    expect(envelope.to).toEqual(['sender@example.com']);
    expect(new Set(envelope.cc)).toEqual(new Set(['colleague@example.com', 'watcher@example.com']));
  });

  it('excludes self case-insensitively from reply-all cc', () => {
    const message = baseMessage({ to: [{ email: 'ME@Example.com' }] });
    const envelope = buildReplyEnvelope(message, 'me@example.com', true);
    expect(envelope.cc).toBeUndefined();
  });

  it('does not cc the original sender even if they also appear in cc', () => {
    const message = baseMessage({
      to: [{ email: 'me@example.com' }],
      cc: [{ email: 'sender@example.com' }],
    });
    const envelope = buildReplyEnvelope(message, 'me@example.com', true);
    expect(envelope.cc).toBeUndefined();
  });

  it('adds a "Re: " prefix to a subject that does not have one', () => {
    const envelope = buildReplyEnvelope(baseMessage({ subject: 'Project update' }), 'me@example.com', false);
    expect(envelope.subject).toBe('Re: Project update');
  });

  it('does not double-prefix a subject that already starts with "Re:"', () => {
    const envelope = buildReplyEnvelope(baseMessage({ subject: 'Re: Project update' }), 'me@example.com', false);
    expect(envelope.subject).toBe('Re: Project update');
  });

  it('is case-insensitive when checking for an existing "re:" prefix', () => {
    const envelope = buildReplyEnvelope(baseMessage({ subject: 'RE: Project update' }), 'me@example.com', false);
    expect(envelope.subject).toBe('RE: Project update');
  });

  it('builds References from an existing References header plus the Message-ID being replied to', () => {
    const envelope = buildReplyEnvelope(
      baseMessage({ messageIdHeader: '<msg2@mail.example.com>', referencesHeader: '<msg1@mail.example.com>' }),
      'me@example.com',
      false,
    );
    expect(envelope.references).toBe('<msg1@mail.example.com> <msg2@mail.example.com>');
    expect(envelope.inReplyTo).toBe('<msg2@mail.example.com>');
  });

  it('falls back to just the Message-ID when there is no prior References header (first reply in a thread)', () => {
    const envelope = buildReplyEnvelope(baseMessage({ messageIdHeader: '<msg1@mail.example.com>' }), 'me@example.com', false);
    expect(envelope.references).toBe('<msg1@mail.example.com>');
  });

  it('leaves references/inReplyTo undefined when the original message has no Message-ID header at all', () => {
    const envelope = buildReplyEnvelope(baseMessage(), 'me@example.com', false);
    expect(envelope.references).toBeUndefined();
    expect(envelope.inReplyTo).toBeUndefined();
  });
});
