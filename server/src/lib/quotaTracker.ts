// Real Gmail API quota usage tracking: every call GmailProvider makes is
// recorded here so we can see actual consumption instead of estimating it.
// Costs are Gmail's published per-method quota units.
interface QuotaEntry {
  method: string;
  cost: number;
  at: number;
}

const WINDOW_MS = 60_000;
const log: QuotaEntry[] = [];

const COSTS: Record<string, number> = {
  'threads.list': 10,
  'threads.get': 40,
  'threads.modify': 10,
  'messages.get': 20,
  'messages.attachments.get': 20,
  'messages.send': 100,
  'history.list': 2,
  'labels.list': 1,
  'labels.create': 1,
  'getProfile': 1,
};

function prune(now: number): void {
  while (log.length && now - log[0].at > WINDOW_MS) {
    log.shift();
  }
}

export function recordCall(method: string): void {
  const cost = COSTS[method] ?? 5;
  const now = Date.now();
  log.push({ method, cost, at: now });
  prune(now);
  const total = log.reduce((sum, e) => sum + e.cost, 0);
  console.log(`[quota] ${method} (+${cost} units), rolling 60s: ${total} units across ${log.length} calls`);
}

// Test-only: `log` is module-level state shared across whatever imports
// this module. Not used by app code.
export function __resetQuotaForTests(): void {
  log.length = 0;
}

export function getQuotaSnapshot() {
  const now = Date.now();
  prune(now);
  const total = log.reduce((sum, e) => sum + e.cost, 0);
  const byMethod: Record<string, { count: number; units: number }> = {};
  for (const e of log) {
    byMethod[e.method] ??= { count: 0, units: 0 };
    byMethod[e.method].count++;
    byMethod[e.method].units += e.cost;
  }
  return {
    windowMs: WINDOW_MS,
    totalUnits: total,
    callCount: log.length,
    byMethod,
    recent: log.slice(-30).map((e) => ({ method: e.method, cost: e.cost, secondsAgo: Math.round((now - e.at) / 1000) })),
  };
}
