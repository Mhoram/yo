// One-time seed: import years of sender decisions/categorization already
// made in HEY (via the `hey` CLI) so they don't have to be re-decided from
// scratch in the Gatekeeper. Existing rows this app already decided (approved
// or blocked through its own UI) are left untouched; only rows still
// 'pending' (or not seen at all) get filled in from HEY's history.
//
// Usage: tsx scripts/import-hey-history.ts <denied.json> <receipts.json> <feed.json>
import fs from 'node:fs';
import { db } from '../src/db/database.js';

interface DeniedEntry {
  email: string;
  name: string;
  decided_at: string;
}

const [deniedPath, receiptsPath, feedPath] = process.argv.slice(2);
if (!deniedPath || !receiptsPath || !feedPath) {
  console.error('Usage: tsx scripts/import-hey-history.ts <denied.json> <receipts.json> <feed.json>');
  process.exit(1);
}

const denied: DeniedEntry[] = JSON.parse(fs.readFileSync(deniedPath, 'utf8'));
const receipts: string[] = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
const feed: string[] = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

const upsert = db.prepare(`
  INSERT INTO sender_approvals (sender_email, sender_domain, display_name, status, first_seen_at, decided_at, bucket, held_count)
  VALUES (@email, @domain, @name, @status, @first_seen_at, @decided_at, @bucket, 0)
  ON CONFLICT(sender_email) DO UPDATE SET
    status = excluded.status,
    decided_at = excluded.decided_at,
    bucket = excluded.bucket
  WHERE sender_approvals.status = 'pending'
`);

let changed = 0;

for (const d of denied) {
  const email = d.email.toLowerCase().trim();
  if (!email.includes('@')) continue;
  const domain = email.split('@')[1] ?? '';
  const info = upsert.run({
    email,
    domain,
    name: d.name,
    status: 'blocked',
    first_seen_at: d.decided_at,
    decided_at: d.decided_at,
    bucket: null,
  });
  changed += info.changes;
}

function importApproved(emails: string[], bucket: 'receipts' | 'feed') {
  const now = new Date().toISOString();
  for (const raw of emails) {
    const email = raw.toLowerCase().trim();
    if (!email.includes('@')) continue;
    const domain = email.split('@')[1] ?? '';
    const info = upsert.run({
      email,
      domain,
      name: null,
      status: 'approved',
      first_seen_at: now,
      decided_at: now,
      bucket,
    });
    changed += info.changes;
  }
}

importApproved(receipts, 'receipts');
importApproved(feed, 'feed');

console.log(`Imported/updated ${changed} sender_approvals rows (${denied.length} denied, ${receipts.length} receipts, ${feed.length} feed considered).`);
