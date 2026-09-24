import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaForTests, getQuotaSnapshot, recordCall } from './quotaTracker.js';

describe('quotaTracker', () => {
  beforeEach(() => {
    __resetQuotaForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the published per-method unit costs', () => {
    recordCall('threads.get');
    recordCall('threads.list');
    const snapshot = getQuotaSnapshot();
    expect(snapshot.byMethod['threads.get']).toEqual({ count: 1, units: 40 });
    expect(snapshot.byMethod['threads.list']).toEqual({ count: 1, units: 10 });
    expect(snapshot.totalUnits).toBe(50);
  });

  it('falls back to a default cost for an unlisted method', () => {
    recordCall('some.unknown.method');
    expect(getQuotaSnapshot().byMethod['some.unknown.method']).toEqual({ count: 1, units: 5 });
  });

  it('drops calls once they age out of the 60s rolling window', () => {
    recordCall('threads.get'); // +40
    vi.advanceTimersByTime(61_000);
    recordCall('threads.list'); // +10, threads.get should now be pruned

    const snapshot = getQuotaSnapshot();
    expect(snapshot.totalUnits).toBe(10);
    expect(snapshot.byMethod['threads.get']).toBeUndefined();
  });

  it('keeps calls still inside the window', () => {
    recordCall('threads.get'); // +40
    vi.advanceTimersByTime(30_000);
    recordCall('threads.list'); // +10, both still within 60s

    expect(getQuotaSnapshot().totalUnits).toBe(50);
  });
});
