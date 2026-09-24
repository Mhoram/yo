// One-time migration: renames the app's Gmail labels after the
// Gatekeeper/Receipts rebrand, moving every thread off the old labels.
//
// The app resolves labels by *name* at runtime (see labelRegistry.ts), so once
// the code was renamed it looks for `App/Gatekeeper-Pending`,
// `App/Gatekeeper-Blocked` and `App/Receipts`. But threads already carrying
// the old labels (`App/Screener-Pending`, `App/Screener-Blocked`,
// `App/Paper-Trail`) would go missing from the views. This script swaps them:
//
//   for each old label:
//     1. find/ensure the replacement label exists
//     2. page through all threads with the old label
//     3. add the new label + remove the old one on each thread
//     4. delete the old label from the mailbox
//
// `App/Feed` is unchanged and skipped.
//
// Safe to re-run: re-runs find no threads on the old labels and no old label
// to delete.
//
// Usage, local dev (from server/):
//   npx tsx scripts/migrate-gmail-labels.mjs [--dry-run]
//   --dry-run: report what would happen (label existence, thread counts),
//     change nothing. Start here.
// Usage, Docker deploy (from the repo root on the host):
//   docker compose cp server/scripts/migrate-gmail-labels.mjs yo:/app/migrate.mjs
//   docker compose exec -w /app/server yo node /app/migrate.mjs
//   docker compose exec yo rm /app/migrate.mjs
//
// In both cases it reads the OAuth tokens from the app's own SQLite DB
// (oauth_tokens table), so sign in once via the app first if needed.

import dotenv from 'dotenv';
import { google } from 'googleapis';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same lookup the server uses (src/env.ts): credentials live in the repo-root
// .env (server/scripts/ is two levels below it). Anchored to this file's
// location so it works regardless of cwd. In the Docker image the env comes
// from compose's env_file instead, so a miss here is a harmless no-op.
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '.env') });
import fs from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');

const RENAMES = [
  ['App/Screener-Pending', 'App/Gatekeeper-Pending'],
  ['App/Screener-Blocked', 'App/Gatekeeper-Blocked'],
  ['App/Paper-Trail', 'App/Receipts'],
];

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in .env');
  process.exit(1);
}

// Default matches dev (server/data/yo.db relative to server/); override with
// DB_PATH when running elsewhere.
const DB_PATH = process.env.DB_PATH || path.resolve('data/yo.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH} (set DB_PATH if it lives elsewhere)`);
  process.exit(1);
}
const sqlite = new Database(DB_PATH, { readonly: true });
const tokens = sqlite.prepare('SELECT * FROM oauth_tokens WHERE id = 1').get();
sqlite.close();
if (!tokens) {
  console.error('No OAuth tokens in the database. Start the app and sign in once first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2.setCredentials({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
const gmail = google.gmail({ version: 'v1', auth: oauth2 });

async function listLabels() {
  const res = await gmail.users.labels.list({ userId: 'me' });
  return (res.data.labels ?? [])
    .filter((l) => l.id && l.name)
    .map((l) => ({ id: l.id, name: l.name }));
}

async function ensureLabelId(name) {
  const existing = (await listLabels()).find((l) => l.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({ userId: 'me', requestBody: { name } });
  console.log(`  created label: ${name}`);
  return created.data.id;
}

async function threadsWithLabel(labelId) {
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.threads.list({ userId: 'me', labelIds: [labelId], pageToken, maxResults: 500 });
    for (const t of res.data.threads ?? []) if (t.id) ids.push(t.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

async function main() {
  if (DRY_RUN) console.log('DRY RUN: no changes will be made\n');
  for (const [oldName, newName] of RENAMES) {
    console.log(`\n${oldName} -> ${newName}`);
    const labels = await listLabels();
    const oldLabel = labels.find((l) => l.name === oldName);
    const newExists = labels.some((l) => l.name === newName);
    if (!oldLabel) {
      console.log('  old label not present, nothing to do');
      continue;
    }
    const threadIds = await threadsWithLabel(oldLabel.id);
    console.log(`  threads on old label: ${threadIds.length}`);
    console.log(`  new label ${newExists ? 'already exists' : 'would be created'}`);
    if (DRY_RUN) {
      console.log('  (dry run, stopping here. nothing changed)');
      continue;
    }
    const newLabelId = await ensureLabelId(newName);
    console.log(`  moving ${threadIds.length} thread(s)`);
    let done = 0;
    for (const id of threadIds) {
      try {
        await gmail.users.threads.modify({
          userId: 'me',
          id,
          requestBody: { addLabelIds: [newLabelId], removeLabelIds: [oldLabel.id] },
        });
      } catch (err) {
        console.error(`  failed on thread ${id}:`, err);
      }
      if (++done % 50 === 0) console.log(`  ${done}/${threadIds.length}`);
    }
    await gmail.users.labels.delete({ userId: 'me', id: oldLabel.id });
    console.log(`  deleted old label ${oldName}`);
  }
  console.log('\ndone');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
