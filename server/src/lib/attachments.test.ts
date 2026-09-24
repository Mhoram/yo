import { describe, expect, it } from 'vitest';
import { parseAttachments } from './attachments.js';

function base64OfSize(bytes: number): string {
  // Rough helper: base64 encoded length is ~4/3 of the raw byte count.
  return 'A'.repeat(Math.ceil((bytes * 4) / 3));
}

describe('parseAttachments', () => {
  it('returns no attachments for undefined/null input', () => {
    expect(parseAttachments(undefined)).toEqual({});
    expect(parseAttachments(null)).toEqual({});
  });

  it('rejects a non-array input', () => {
    const result = parseAttachments('not-an-array');
    expect(result.error).toMatch(/must be an array/);
  });

  it('parses valid attachments through unchanged', () => {
    const result = parseAttachments([
      { filename: 'a.png', contentBase64: 'AAAA', contentType: 'image/png' },
      { filename: 'b.pdf', contentBase64: 'BBBB' },
    ]);
    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      { filename: 'a.png', contentBase64: 'AAAA', contentType: 'image/png' },
      { filename: 'b.pdf', contentBase64: 'BBBB', contentType: undefined },
    ]);
  });

  it('rejects an item missing a filename', () => {
    const result = parseAttachments([{ contentBase64: 'AAAA' }]);
    expect(result.error).toMatch(/filename is required/);
  });

  it('rejects an item with a blank filename', () => {
    const result = parseAttachments([{ filename: '   ', contentBase64: 'AAAA' }]);
    expect(result.error).toMatch(/filename is required/);
  });

  it('rejects an item missing contentBase64', () => {
    const result = parseAttachments([{ filename: 'a.png' }]);
    expect(result.error).toMatch(/contentBase64 is required/);
  });

  it('rejects a non-string contentType', () => {
    const result = parseAttachments([{ filename: 'a.png', contentBase64: 'AAAA', contentType: 123 }]);
    expect(result.error).toMatch(/contentType must be a string/);
  });

  it('accepts attachments right at Gmail\'s 25MB total cap', () => {
    const result = parseAttachments([{ filename: 'big.bin', contentBase64: base64OfSize(24 * 1024 * 1024) }]);
    expect(result.error).toBeUndefined();
  });

  it('rejects attachments totaling over Gmail\'s 25MB cap', () => {
    const result = parseAttachments([{ filename: 'big.bin', contentBase64: base64OfSize(30 * 1024 * 1024) }]);
    expect(result.error).toMatch(/25MB/);
  });

  it('sums multiple attachments toward the total size cap', () => {
    const result = parseAttachments([
      { filename: 'a.bin', contentBase64: base64OfSize(15 * 1024 * 1024) },
      { filename: 'b.bin', contentBase64: base64OfSize(15 * 1024 * 1024) },
    ]);
    expect(result.error).toMatch(/25MB/);
  });

  it('reports the index of the offending item in a mixed batch', () => {
    const result = parseAttachments([{ filename: 'a.png', contentBase64: 'AAAA' }, { filename: '' }]);
    expect(result.error).toMatch(/attachments\[1\]/);
  });
});
