import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves result order regardless of completion order', async () => {
    const delays = [30, 10, 20, 5, 25];
    const results = await mapWithConcurrency(delays, 2, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
    expect(results).toEqual(delays);
  });

  it('never runs more than `limit` calls concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('handles an empty input list', async () => {
    const results = await mapWithConcurrency<number, number>([], 5, async (i) => i);
    expect(results).toEqual([]);
  });

  it('handles a limit larger than the item count', async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (i) => i * 2);
    expect(results).toEqual([2, 4]);
  });
});
