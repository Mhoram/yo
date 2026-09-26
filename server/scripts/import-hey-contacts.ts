// One-time seed: import the contacts you saved in HEY into the compose
// autocomplete cache (known_contacts). Complements import-hey-history.ts,
// which imports sender *decisions*; this one imports your curated address
// book, which the Gmail header harvest can't see (those people may never
// have mailed your Gmail address).
//
// Usage:
//   hey contact list --json > hey-contacts.json
//   (the CLI paginates; if meta.pages_fetched > 1, also dump --page 2 etc.
//    and pass every file)
//   npm run tsx scripts/import-hey-contacts.ts hey-contacts.json [more.json...]
//
// Accepts the full `hey contact list --json` envelope ({ ok, data: [...] })
// or a bare array of contacts. Rows already known get their name filled in
// and a single use_count bump (a contact you deliberately saved outranks
// passively harvested addresses); existing names are never overwritten.

import fs from 'node:fs';
import { db } from '../src/db/database.js';

interface HeyContact {
  email_address?: string;
  name?: string | null;
  updated_at?: string;
}

interface HeyEnvelope {
  ok?: boolean;
  data?: HeyContact[];
}

const [firstPath, ...restPaths] = process.argv.slice(2);
const paths = firstPath ? [firstPath, ...restPaths] : [];
if (paths.length === 0) {
  console.error('Usage: tsx scripts/import-hey-contacts.ts <hey-contacts.json> [more.json...]');
  console.error('Generate with: hey contact list --json > hey-contacts.json');
  process.exit(1);
}

const upsert = db.prepare(`
  INSERT INTO known_contacts (email, name, use_count, last_used_at)
  VALUES (@email, @name, 1, @now)
  ON CONFLICT(email) DO UPDATE SET
    name = COALESCE(known_contacts.name, excluded.name),
    use_count = known_contacts.use_count + 1,
    last_used_at = excluded.last_used_at
`);

function cleanName(raw: string | null | undefined): string | null {
  let name = raw?.trim() ?? '';
  // HEY's Service contacts put a full '"Name" <email>' into the name field;
  // keep only the display-name part.
  const lt = name.indexOf('<');
  if (lt >= 0) name = name.slice(0, lt);
  name = name.trim().replace(/^"+|"+$/g, '').trim();
  return name ? name : null;
}

let imported = 0;
let skipped = 0;

for (const path of paths) {
  const parsed: HeyContact[] | HeyEnvelope = JSON.parse(fs.readFileSync(path, 'utf8'));
  const contacts = Array.isArray(parsed) ? parsed : (parsed.data ?? []);

  for (const c of contacts) {
    const email = c.email_address?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skipped += 1;
      continue;
    }
    upsert.run({ email, name: cleanName(c.name), now: new Date().toISOString() });
    imported += 1;
  }
}

console.log(`Imported ${imported} contact(s), skipped ${skipped} without a usable email address.`);
