import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMailProvider } from '../test/FakeMailProvider.js';
import { ensureLabel, __resetLabelCacheForTests } from './labelRegistry.js';

beforeEach(() => {
  __resetLabelCacheForTests();
});

describe('ensureLabel', () => {
  it('creates a label that does not exist yet', async () => {
    const provider = new FakeMailProvider();
    const id = await ensureLabel(provider, 'App/Test');
    expect(id).toBeTruthy();
    expect((await provider.listLabels()).find((l) => l.name === 'App/Test')?.id).toBe(id);
  });

  it('reuses an already-existing label instead of creating a duplicate', async () => {
    const provider = new FakeMailProvider();
    const first = await ensureLabel(provider, 'App/Test');
    __resetLabelCacheForTests(); // force a fresh lookup, bypassing the in-memory cache
    const second = await ensureLabel(provider, 'App/Test');
    expect(second).toBe(first);
    expect((await provider.listLabels()).filter((l) => l.name === 'App/Test')).toHaveLength(1);
  });

  it('de-duplicates concurrent calls for the same brand-new label name (the race that used to 409)', async () => {
    const provider = new FakeMailProvider();
    const createSpy = vi.spyOn(provider, 'createLabel');

    // Several "threads" resolving to the same new label at once, as happens
    // when a batch of new senders is gated in the same request.
    const results = await Promise.all([
      ensureLabel(provider, 'App/Race'),
      ensureLabel(provider, 'App/Race'),
      ensureLabel(provider, 'App/Race'),
    ]);

    expect(new Set(results).size).toBe(1); // all resolved to the same id
    expect(createSpy).toHaveBeenCalledTimes(1); // only one actual create call
  });

  it('caches across calls so a second request for the same name never lists/creates again', async () => {
    const provider = new FakeMailProvider();
    const listSpy = vi.spyOn(provider, 'listLabels');
    const createSpy = vi.spyOn(provider, 'createLabel');

    await ensureLabel(provider, 'App/Cached');
    await ensureLabel(provider, 'App/Cached');
    await ensureLabel(provider, 'App/Cached');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
