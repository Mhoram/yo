import type { MailProvider } from './MailProvider.js';

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

export async function ensureLabel(mailProvider: MailProvider, name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  // Multiple threads can resolve to the same brand-new label name in the
  // same batch (e.g. several new senders gated concurrently on first load),
  // share one in-flight resolution per name so they don't race to create it.
  const existingInFlight = inFlight.get(name);
  if (existingInFlight) return existingInFlight;

  const promise = resolveLabel(mailProvider, name).finally(() => inFlight.delete(name));
  inFlight.set(name, promise);
  return promise;
}

async function resolveLabel(mailProvider: MailProvider, name: string): Promise<string> {
  const labels = await mailProvider.listLabels();
  const existing = labels.find((l) => l.name === name);
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }

  try {
    const created = await mailProvider.createLabel(name);
    cache.set(name, created.id);
    return created.id;
  } catch (err) {
    // Lost a race with another process/request that created it first (or it
    // already existed from an earlier run); look it up instead of failing.
    const isConflict = (err as { code?: number; status?: number }).code === 409 || (err as { code?: number; status?: number }).status === 409;
    if (!isConflict) throw err;

    const refreshed = await mailProvider.listLabels();
    const found = refreshed.find((l) => l.name === name);
    if (!found) throw err;
    cache.set(name, found.id);
    return found.id;
  }
}

// Test-only: the cache above is module-level state shared across whatever
// imports this module, which is wrong across test cases using their own
// fake MailProvider instances. Not used by app code.
export function __resetLabelCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
