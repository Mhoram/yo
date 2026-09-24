import { describe, expect, it } from 'vitest';
import { avatarColorClass, initialsFor } from './avatarColor';

describe('avatarColorClass', () => {
  it('is deterministic: same email always yields the same class', () => {
    const a = avatarColorClass('jane@example.com');
    const b = avatarColorClass('jane@example.com');
    expect(a).toBe(b);
  });

  it('is case-insensitive on the email', () => {
    expect(avatarColorClass('Jane@Example.com')).toBe(avatarColorClass('jane@example.com'));
  });

  it('picks from the fixed 8-hue palette', () => {
    const cls = avatarColorClass('someone@example.com');
    expect(cls).toMatch(/^bg-\[hsl\(var\(--avatar-[1-8]\)\)\]$/);
  });

  it('spreads different emails across more than one color (not everyone the same bucket)', () => {
    const emails = Array.from({ length: 20 }, (_, i) => `user${i}@example.com`);
    const classes = new Set(emails.map(avatarColorClass));
    expect(classes.size).toBeGreaterThan(1);
  });
});

describe('initialsFor', () => {
  it('uses the first letter of the first two words of a display name', () => {
    expect(initialsFor('Jane Doe', 'jane@example.com')).toBe('JD');
  });

  it('falls back to the email when no name is given', () => {
    expect(initialsFor(undefined, 'jane@example.com')).toBe('JA');
  });

  it('falls back to the email when the name is blank', () => {
    expect(initialsFor('   ', 'jane@example.com')).toBe('JA');
  });

  it('always uppercases the result', () => {
    expect(initialsFor('jane doe', 'jane@example.com')).toBe('JD');
  });
});
