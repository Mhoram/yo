// Batch repair for mis-filed senders found by audit-sender-filing.mjs.
// Re-files ALL of a sender's non-trash/spam threads into the bucket their
// sender_approvals row currently says — mirroring
// gatekeeperService.moveSenderToBucket's re-file semantics (add the target
// label, remove INBOX and the other bucket's label; archived threads carry
// no location label so nothing else to strip).
//
// Usage:
//   cd server && node scripts/repair-sender-filing.mjs           # dry run: prints plan + thread counts (read-only)
//   cd server && node scripts/repair-sender-filing.mjs --apply   # actually modifies labels
//
// Reads the MISMATCH lines from /tmp/audit-results.txt, buckets from data/yo.db
// (source of truth — never trusts the audit file for the target bucket).
// Results: /tmp/repair-results.txt

import { google } from 'googleapis';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import dotenv from 'dotenv';

const APPLY = process.argv.includes('--apply');

dotenv.config({ path: '../.env' });

const db = new Database('data/yo.db', { readonly: true });
const t = db.prepare('SELECT * FROM oauth_tokens WHERE id = 1').get();
const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
auth.setCredentials({ access_token: t.access_token, refresh_token: t.refresh_token, expiry_date: t.expiry_date });
const gmail = google.gmail({ version: 'v1', auth });

const BUCKET_LABELS = { receipts: 'App/Receipts', feed: 'App/Feed' };

// --- rate limiting: each threads.* call costs 10 units; stay under 250/min ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let budget = [];
async function paced(fn) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    budget = budget.filter((ts) => now - ts < 60_000);
    if (budget.length >= 22) {
      await sleep(60_000 - (now - budget[0]) + 200);
      continue;
    }
    try {
      budget.push(Date.now());
      return await fn();
    } catch (e) {
      const msg = e?.errors?.[0]?.reason ?? e?.message ?? '';
      if (/rateLimitExceeded|quotaExceeded|backendError/.test(msg) && attempt < 5) {
        console.error(`  rate-limited, backing off 30s (attempt ${attempt + 1})`);
        await sleep(30_000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

// --- parse mismatch list, resolve target bucket from the DB ---
const auditLines = fs.readFileSync('/tmp/audit-results.txt', 'utf8').split('\n');
const mismatchedEmails = auditLines
  .filter((l) => l.startsWith('MISMATCH'))
  .map((l) => l.split(/\s+/)[1]);
if (mismatchedEmails.length === 0) {
  console.error('no MISMATCH lines in /tmp/audit-results.txt — nothing to do');
  process.exit(0);
}

const getBucket = db.prepare("SELECT bucket FROM sender_approvals WHERE sender_email = ? AND status = 'approved'");
const plan = [];
for (const email of mismatchedEmails) {
  const row = getBucket.get(email);
  if (!row) {
    console.error(`SKIP ${email}: not an approved sender anymore`);
    continue;
  }
  plan.push({ email, bucket: row.bucket });
}

const labelsRes = await gmail.users.labels.list({ userId: 'me' });
const idFor = (name) => (labelsRes.data.labels ?? []).find((l) => l.id === name || l.name === name)?.id;
const receiptsId = idFor('App/Receipts');
const feedId = idFor('App/Feed');
if (!receiptsId || !feedId) throw new Error(`bucket labels missing: receipts=${receiptsId} feed=${feedId}`);

function labelOpsFor(bucket) {
  // mirror moveSenderToBucket: add target, remove INBOX + other bucket label
  if (bucket === 'receipts') return { add: [receiptsId], remove: ['INBOX', feedId] };
  if (bucket === 'feed') return { add: [feedId], remove: ['INBOX', receiptsId] };
  return { add: ['INBOX'], remove: [receiptsId, feedId] }; // yobox
}

// --- count threads per sender (paged; Gmail search excludes trash/spam) ---
async function allThreadIds(email) {
  const ids = [];
  let pageToken;
  do {
    const res = await paced(() =>
      gmail.users.threads.list({ userId: 'me', q: `from:${email}`, maxResults: 100, pageToken }),
    );
    for (const th of res.data.threads ?? []) ids.push(th.id);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return ids;
}

fs.writeFileSync('/tmp/repair-results.txt', `repair run ${APPLY ? '(APPLY)' : '(DRY RUN)'} at ${new Date().toISOString()}\n`);
let done = 0, totalThreads = 0;
for (const { email, bucket } of plan) {
  const ops = labelOpsFor(bucket);
  const threadIds = await allThreadIds(email);
  done++;
  totalThreads += threadIds.length;
  const line = `${APPLY ? 'REPAIRED' : 'WOULD_REPAIR'} ${email}  bucket:${bucket ?? 'yobox'}  threads:${threadIds.length}`;
  console.log(`[${done}/${plan.length}] ${line}`);
  fs.appendFileSync('/tmp/repair-results.txt', line + '\n');

  if (!APPLY || threadIds.length === 0) continue;
  let modified = 0;
  for (const id of threadIds) {
    await paced(() =>
      gmail.users.threads.modify({
        userId: 'me',
        id,
        requestBody: { addLabelIds: ops.add, removeLabelIds: ops.remove },
      }),
    );
    modified++;
    if (modified % 50 === 0) console.log(`  ${email}: ${modified}/${threadIds.length} threads re-filed`);
  }
}

fs.appendFileSync(
  '/tmp/repair-results.txt',
  `--- done. senders: ${plan.length}, threads ${APPLY ? 're-filed' : 'would re-file'}: ${totalThreads}\n`,
);
console.log(`--- done. senders: ${plan.length}, threads ${APPLY ? 're-filed' : 'would re-file'}: ${totalThreads}`);
