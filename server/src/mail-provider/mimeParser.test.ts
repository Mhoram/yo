import { describe, expect, it } from 'vitest';
import { parseAddress, parseAddressList, splitAddressList } from './mimeParser.js';

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
