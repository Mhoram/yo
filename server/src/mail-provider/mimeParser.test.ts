import { describe, expect, it } from 'vitest';
import { parseAddress, parseAddressList, parseGmailMessage, splitAddressList } from './mimeParser.js';

describe('parseAddress', () => {
  it('parses "Name <email>" form', () => {
    expect(parseAddress('Jane Doe <jane@example.com>')).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
  });

  it('parses quoted display names', () => {
    expect(parseAddress('"Doe, Jane" <jane@example.com>')).toEqual({
      name: 'Doe, Jane',
      email: 'jane@example.com',
    });
  });

  it('parses a bare email with no display name', () => {
    expect(parseAddress('jane@example.com')).toEqual({ email: 'jane@example.com' });
  });

  it('lowercases and trims the email address', () => {
    expect(parseAddress('  Jane Doe <Jane@Example.COM>  ')).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('omits name when the display name is empty', () => {
    expect(parseAddress('<jane@example.com>')).toEqual({ email: 'jane@example.com' });
  });
});

describe('splitAddressList', () => {
  it('splits plain comma-separated addresses', () => {
    expect(splitAddressList('a@example.com, b@example.com')).toEqual(['a@example.com', ' b@example.com']);
  });

  it('does not split on a comma inside a quoted display name', () => {
    // This is the real bug: a naive raw.split(',') breaks "Doe, Jane" into
    // two garbage fragments: a header shape Outlook/Exchange commonly sends.
    const result = splitAddressList('"Doe, Jane" <jane@example.com>, bob@example.com');
    expect(result).toEqual(['"Doe, Jane" <jane@example.com>', ' bob@example.com']);
  });

  it('handles multiple quoted names each containing a comma', () => {
    const result = splitAddressList('"Doe, Jane" <jane@example.com>, "Smith, Bob" <bob@example.com>');
    expect(result).toEqual(['"Doe, Jane" <jane@example.com>', ' "Smith, Bob" <bob@example.com>']);
  });
});

describe('parseAddressList', () => {
  it('returns an empty list for an empty header', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('parses a single address', () => {
    expect(parseAddressList('jane@example.com')).toEqual([{ email: 'jane@example.com' }]);
  });

  it('parses multiple plain addresses', () => {
    expect(parseAddressList('jane@example.com, bob@example.com')).toEqual([
      { email: 'jane@example.com' },
      { email: 'bob@example.com' },
    ]);
  });

  it('correctly parses a quoted display name containing a comma alongside another recipient', () => {
    const result = parseAddressList('"Doe, Jane" <jane@example.com>, bob@example.com');
    expect(result).toEqual([
      { name: 'Doe, Jane', email: 'jane@example.com' },
      { email: 'bob@example.com' },
    ]);
  });
});

describe('parseGmailMessage body extraction', () => {
  const htmlData = Buffer.from('<p>real body</p>').toString('base64url');

  it('does not misclassify a text/html body part that carries a filename', () => {
    // Outlook/Exchange name their body parts (inline; filename="body.html")
    const msg: Parameters<typeof parseGmailMessage>[0] = {
      id: 'm1',
      threadId: 't1',
      snippet: '',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [],
        parts: [
          {
            mimeType: 'text/html',
            filename: 'body.html',
            headers: [
              { name: 'Content-Type', value: 'text/html' },
              { name: 'Content-Disposition', value: 'inline; filename="body.html"' },
            ],
            body: { data: htmlData, attachmentId: 'A1', size: 10 },
          },
        ],
      },
    };
    const { message } = parseGmailMessage(msg);
    expect(message.bodyHtml).toBe('<p>real body</p>');
    expect(message.attachments).toHaveLength(0);
  });

  it('still treats an explicitly attached text file as an attachment', () => {
    const msg: Parameters<typeof parseGmailMessage>[0] = {
      id: 'm1',
      threadId: 't1',
      snippet: '',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [],
        parts: [
          {
            mimeType: 'text/plain',
            filename: 'notes.txt',
            headers: [
              { name: 'Content-Type', value: 'text/plain' },
              { name: 'Content-Disposition', value: 'attachment; filename="notes.txt"' },
            ],
            body: { data: Buffer.from('attached text').toString('base64url'), attachmentId: 'A2', size: 13 },
          },
        ],
      },
    };
    const { message } = parseGmailMessage(msg);
    expect(message.bodyText).toBeUndefined();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('notes.txt');
  });
});
