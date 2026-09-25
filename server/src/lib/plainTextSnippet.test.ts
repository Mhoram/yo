import { describe, expect, it } from 'vitest';
import { plainTextSnippet } from './plainTextSnippet.js';

describe('plainTextSnippet', () => {
  it('decodes HTML entities like single quotes and ampersands', () => {
    expect(plainTextSnippet("We&#39;re constantly looking &amp; learning")).toBe(
      "We're constantly looking & learning",
    );
  });

  it('decodes quoted attributes from Gmail snippets', () => {
    expect(plainTextSnippet('He said &quot;hello&quot; there')).toBe('He said "hello" there');
  });

  it('strips tags while keeping their text content', () => {
    expect(plainTextSnippet('<b>Bold</b> plain')).toBe('Bold plain');
  });

  it('leaves already-plain text alone (safe to apply twice)', () => {
    const plain = "We're already plain text";
    expect(plainTextSnippet(plain)).toBe(plain);
  });
});
