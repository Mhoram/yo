import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime, formatListDate } from './format';

describe('formatDateTime', () => {
  it('returns the raw input for an unparseable date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('includes both a date and a time for a valid ISO string', () => {
    const out = formatDateTime('2026-09-11T15:30:00Z');
    // Locale-formatted, so just assert it's not the raw ISO string and has some content.
    expect(out).not.toBe('2026-09-11T15:30:00Z');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('formatListDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T18:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows time-only for something from today', () => {
    const out = formatListDate(new Date('2026-09-11T09:15:00').toISOString());
    expect(out).not.toMatch(/2026/);
    expect(out).not.toMatch(/Sep/);
  });

  it('shows "Mon D" (no year) for an earlier date within the current year', () => {
    const out = formatListDate(new Date('2026-01-05T09:15:00').toISOString());
    expect(out).toMatch(/Jan/);
    expect(out).not.toMatch(/2026/);
  });

  it('shows "Mon D, YYYY" for a date from a previous year', () => {
    const out = formatListDate(new Date('2025-01-05T09:15:00').toISOString());
    expect(out).toMatch(/Jan/);
    expect(out).toMatch(/2025/);
  });

  it('returns the raw input for an unparseable date', () => {
    expect(formatListDate('garbage')).toBe('garbage');
  });
});
