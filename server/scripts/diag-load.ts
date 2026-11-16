import { env } from '../src/env.js';
import { GmailProvider } from '../src/mail-provider/GmailProvider.js';
import { gateThreadBySender, __flushDeferredFilingForTests } from '../src/gatekeeper/gatekeeperService.js';
import { mapWithConcurrency } from '../src/lib/concurrency.js';
import { buildThreadSummary } from '../src/lib/threadSummary.js';
import { readThreadListPage, writeThreadListPage } from '../src/db/threadListCache.js';

const provider = new GmailProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

async function load(name: string) {
  const t0 = Date.now();
  const historyId = await provider.getCurrentHistoryId();
  const cached = readThreadListPage('INBOX');
  if (cached && cached.historyId === historyId) {
    console.log(`${name}: CACHE HIT ${Date.now() - t0}ms (${cached.summaries.length} threads)`);
    return;
  }
  const list = await provider.listThreadIds({ label: 'INBOX', maxResults: 15 });
  const threads = await mapWithConcurrency(list.threadIds, 5, (id) => provider.getThread(id, { full: false }));
  const visible: typeof threads = [];
  await mapWithConcurrency(threads, 5, async (thread) => {
    const last = thread.messages.at(-1);
    if (!last) return;
    const gate = await gateThreadBySender(provider, { id: thread.id, snippet: last.snippet || thread.snippet }, last.from, { deferFiling: true });
    if (gate.status === 'approved' && (gate.bucket === null || gate.bucket === 'yobox')) visible.push(thread);
  });
  writeThreadListPage('INBOX', historyId, list.nextPageToken, visible.map(buildThreadSummary));
  console.log(`${name}: LIVE ${Date.now() - t0}ms (visible: ${visible.length}) — response sent now, filing continues in background`);
  const t1 = Date.now();
  await __flushDeferredFilingForTests();
  console.log(`${name}: background filing settled +${Date.now() - t1}ms`);
}

async function main() {
  await load('load 1');
  await load('load 2');
  await load('load 3');
}
main().catch((e) => { console.error(e); process.exit(1); });
