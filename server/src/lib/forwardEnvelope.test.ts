import { describe, expect, it } from 'vitest';
import { buildForwardEnvelope } from './forwardEnvelope.js';
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
    date: '2026-09-13T10:00:00Z',
    labelIds: [],
    attachments: [],
    ...overrides,
  };
}

describe('buildForwardEnvelope', () => {
  it('sends to the given recipients', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['alice@example.com', 'bob@example.com']);
    expect(envelope.to).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('adds a "Fwd: " prefix to a subject that does not have one', () => {
    const envelope = buildForwardEnvelope(baseMessage({ subject: 'Project update' }), ['a@example.com']);
    expect(envelope.subject).toBe('Fwd: Project update');
  });

  it('does not double-prefix a subject that already starts with "Fwd:"', () => {
    const envelope = buildForwardEnvelope(baseMessage({ subject: 'Fwd: Project update' }), ['a@example.com']);
    expect(envelope.subject).toBe('Fwd: Project update');
  });

  it('includes the original From/Date/Subject/To in the quoted block', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['a@example.com']);
    expect(envelope.bodyText).toContain('Sender <sender@example.com>');
    expect(envelope.bodyText).toContain('2026-09-13T10:00:00Z');
    expect(envelope.bodyText).toContain('Subject: Project update');
    expect(envelope.bodyText).toContain('me@example.com');
  });

  it('prefers the plain-text body when available', () => {
    const envelope = buildForwardEnvelope(
      baseMessage({ bodyText: 'Plain text body', bodyHtml: '<p>Html body</p>' }),
      ['a@example.com'],
    );
    expect(envelope.bodyText).toContain('Plain text body');
    expect(envelope.bodyText).not.toContain('Html body');
  });

  it('falls back to a stripped version of the HTML body when there is no plain-text body', () => {
    const envelope = buildForwardEnvelope(
      baseMessage({ bodyHtml: '<p>Hello <b>world</b></p><p>Second paragraph</p>' }),
      ['a@example.com'],
    );
    expect(envelope.bodyText).toContain('Hello world');
    expect(envelope.bodyText).toContain('Second paragraph');
    expect(envelope.bodyText).not.toContain('<p>');
    expect(envelope.bodyText).not.toContain('<b>');
  });

  it('lists original attachments in the quoted block', () => {
    const envelope = buildForwardEnvelope(
      baseMessage({
        attachments: [
          { attachmentId: 'a1', filename: 'report.pdf', mimeType: 'application/pdf', size: 123 },
          { attachmentId: 'a2', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 456 },
        ],
      }),
      ['a@example.com'],
    );
    expect(envelope.bodyText).toContain('Attachments: report.pdf, photo.jpg');
  });

  it('omits the attachments line when the message has none', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['a@example.com']);
    expect(envelope.bodyText).not.toContain('Attachments:');
  });

  it('prepends a personal note when one is given', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['a@example.com'], 'Thought you should see this');
    expect(envelope.bodyText.startsWith('Thought you should see this')).toBe(true);
    expect(envelope.bodyText).toContain('---------- Forwarded message ---------');
  });

  it('omits the note entirely when none is given', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['a@example.com']);
    expect(envelope.bodyText.startsWith('---------- Forwarded message ---------')).toBe(true);
  });

  it('ignores a note that is only whitespace', () => {
    const envelope = buildForwardEnvelope(baseMessage(), ['a@example.com'], '   ');
    expect(envelope.bodyText.startsWith('---------- Forwarded message ---------')).toBe(true);
  });
});
