import { describe, expect, it } from 'vitest';
import { extractDomain, parseBimiRecord } from './bimiLookup.js';

describe('extractDomain', () => {
  it('returns the lowercased domain after the @', () => {
    expect(extractDomain('Jane@Example.COM')).toBe('example.com');
  });

  it('returns null when there is no @', () => {
    expect(extractDomain('not-an-email')).toBeNull();
  });

  it('returns null when the @ is the last character', () => {
    expect(extractDomain('jane@')).toBeNull();
  });
});

describe('parseBimiRecord', () => {
  it('extracts the logo URL from a valid BIMI record', () => {
    expect(parseBimiRecord('v=BIMI1; l=https://example.com/logo.svg;')).toBe('https://example.com/logo.svg');
  });

  it('extracts the logo URL when there is also an authority evidence field', () => {
    expect(parseBimiRecord('v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem')).toBe(
      'https://example.com/logo.svg',
    );
  });

  it('rejects records with the wrong version', () => {
    expect(parseBimiRecord('v=spf1 include:example.com')).toBeNull();
  });

  it('rejects a non-https logo URL', () => {
    expect(parseBimiRecord('v=BIMI1; l=http://example.com/logo.svg;')).toBeNull();
  });

  it('rejects a logo URL that is not an SVG', () => {
    expect(parseBimiRecord('v=BIMI1; l=https://example.com/logo.png;')).toBeNull();
  });

  it('rejects a malformed logo URL', () => {
    expect(parseBimiRecord('v=BIMI1; l=not-a-url;')).toBeNull();
  });

  it('returns null when there is no l= field', () => {
    expect(parseBimiRecord('v=BIMI1; a=https://example.com/vmc.pem')).toBeNull();
  });
});
